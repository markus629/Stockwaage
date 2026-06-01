"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  addScale,
  commentsCol,
  computePinOwners,
  dailyStatsCol,
  deviceDoc,
  liveDoc,
  mainConfigDoc,
  MAX_SCALES,
  readingsCol,
  removeScale,
  scalesCol,
  type Comment,
  type DailyStat,
  type Device,
  type MainConfig,
  type Reading,
  type ScaleConfig,
} from "@/lib/devices";
import CalibrationWizard from "@/components/CalibrationWizard";
import Dashboard from "@/components/Dashboard";
import OnlineDot from "@/components/OnlineDot";
import ScaleCard from "@/components/ScaleCard";
import SettingsPanel from "@/components/SettingsPanel";
import { useDeviceTab, useScaleUiPrefs } from "@/lib/uiPrefs";

// Rohdaten werden NICHT mehr pauschal als 21-Tage-Live-Listener geladen
// (das waren ~2000 Reads pro Seitenaufruf). Stattdessen lazy pro Tab und
// nur so viele Tage wie der jeweilige Tab wirklich braucht – per getDocs
// (einmalig) statt Live-Listener. Der aktuelle Messwert kommt weiter live
// ueber `latest` (1 Dokument).
const DASHBOARD_RAW_DAYS = 3;
const DEFAULT_STACK_DAYS = 7;

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Laden…</div>}>
      <DeviceDetail />
    </Suspense>
  );
}

function TopTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-neutral-900 text-neutral-900"
          : "border-transparent text-neutral-500 hover:text-neutral-900"
      }`}
    >
      {children}
    </button>
  );
}

function DeviceDetail() {
  const sp = useSearchParams();
  const deviceId = sp.get("id") ?? "";
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [device, setDevice] = useState<Device | null>(null);
  const [mainCfg, setMainCfg] = useState<MainConfig>({});
  const [scales, setScales] = useState<Record<string, ScaleConfig>>({});
  const [latest, setLatest] = useState<Reading | null>(null);
  const [live, setLive] = useState<Reading | null>(null);
  const [windowReadings, setWindowReadings] = useState<Reading[]>([]);
  const [loadedRawDays, setLoadedRawDays] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [dailyLoaded, setDailyLoaded] = useState(false);
  const [wizardFor, setWizardFor] = useState<string | null>(null);
  const [scrollToScale, setScrollToScale] = useState<string | null>(null);
  const uiPrefs = useScaleUiPrefs(deviceId);
  const [tab, setTab] = useDeviceTab(deviceId);

  // Klick auf eine Dashboard-Kachel -> in den Waagen-Tab springen, die Karte
  // aufklappen und dorthin scrollen.
  function goToScale(sid: string) {
    uiPrefs.set(sid, { cardOpen: true });
    setTab("scales");
    setScrollToScale(sid);
  }

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user || user === "loading" || !deviceId) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(
      onSnapshot(deviceDoc(deviceId), (s) =>
        setDevice(s.exists() ? ({ id: s.id, ...s.data() } as Device) : null),
      ),
    );
    unsubs.push(
      onSnapshot(mainConfigDoc(deviceId), (s) =>
        setMainCfg((s.exists() ? s.data() : {}) as MainConfig),
      ),
    );
    unsubs.push(
      onSnapshot(scalesCol(deviceId), (snap) => {
        const map: Record<string, ScaleConfig> = {};
        for (const d of snap.docs) {
          map[d.id] = { id: d.id, ...(d.data() as Omit<ScaleConfig, "id">) };
        }
        setScales(map);
      }),
    );
    unsubs.push(
      onSnapshot(
        query(readingsCol(deviceId), orderBy("ts", "desc"), limit(1)),
        (snap) => setLatest((snap.docs[0]?.data() as Reading) ?? null),
      ),
    );
    // Live-Gewicht (vom ESP nur im Wachbetrieb geschrieben).
    unsubs.push(
      onSnapshot(liveDoc(deviceId), (s) =>
        setLive(s.exists() ? (s.data() as Reading) : null),
      ),
    );
    unsubs.push(
      onSnapshot(commentsCol(deviceId), (snap) =>
        setComments(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Comment),
        ),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [user, deviceId]);

  const scaleIds = useMemo(
    () => Object.keys(scales).sort((a, b) => a.localeCompare(b)),
    [scales],
  );

  // Aktueller Messwert fuer die Live-Anzeige: das Live-Dokument (Wachbetrieb,
  // alle ~5s) bevorzugen, solange es neuer ist als das letzte normale Reading;
  // sonst Fallback auf das letzte Reading.
  const current = useMemo<Reading | null>(() => {
    if (live && (!latest || (live.ts ?? 0) >= (latest.ts ?? 0))) return live;
    return latest;
  }, [live, latest]);

  // Nach dem Tab-Wechsel zur angeklickten Waage scrollen.
  useEffect(() => {
    if (tab !== "scales" || !scrollToScale) return;
    document
      .getElementById(`scale-${scrollToScale}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollToScale(null);
  }, [tab, scrollToScale]);

  // Beim Geraetewechsel die lazy geladenen Daten verwerfen.
  useEffect(() => {
    setWindowReadings([]);
    setLoadedRawDays(0);
    setDailyStats([]);
    setDailyLoaded(false);
  }, [deviceId]);

  // Wie viele Tage Rohdaten braucht der aktuelle Tab?
  //  - Dashboard: 3 Tage (Kacheln + Schwarm-Erkennung)
  //  - Waagen: so viele Tage wie der groesste 24h-Stapel-Stepper
  //  - Einstellungen: keine (nur `latest`)
  const maxStackDays = scaleIds.length
    ? Math.max(
        ...scaleIds.map((sid) => uiPrefs.get(sid).stackDays ?? DEFAULT_STACK_DAYS),
      )
    : DASHBOARD_RAW_DAYS;
  const neededRawDays =
    tab === "dashboard"
      ? DASHBOARD_RAW_DAYS
      : tab === "scales"
        ? maxStackDays
        : 0;

  // Rohdaten lazy per getDocs nachladen (einmalig, kein Live-Listener).
  // Nur wenn der Tab mehr Tage braucht als bereits geladen sind.
  useEffect(() => {
    if (!user || user === "loading" || !deviceId) return;
    if (neededRawDays === 0 || neededRawDays <= loadedRawDays) return;
    let cancelled = false;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const cutoff = start.getTime() - (neededRawDays - 1) * 86_400_000;
    getDocs(
      query(readingsCol(deviceId), where("ts", ">=", cutoff), orderBy("ts", "asc")),
    ).then((snap) => {
      if (cancelled) return;
      setWindowReadings(snap.docs.map((d) => d.data() as Reading));
      setLoadedRawDays(neededRawDays);
    });
    return () => {
      cancelled = true;
    };
  }, [user, deviceId, neededRawDays, loadedRawDays]);

  // dailyStats (Langzeit/Tagesaggregate) ebenfalls lazy: nur in Dashboard +
  // Waagen-Tab, einmalig per getDocs. In den Einstellungen gar nicht.
  useEffect(() => {
    if (!user || user === "loading" || !deviceId) return;
    if (tab === "settings" || dailyLoaded) return;
    let cancelled = false;
    getDocs(query(dailyStatsCol(deviceId), orderBy("date", "asc"))).then(
      (snap) => {
        if (cancelled) return;
        setDailyStats(snap.docs.map((d) => d.data() as DailyStat));
        setDailyLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [user, deviceId, tab, dailyLoaded]);

  const pinOwners = useMemo(
    () => computePinOwners(scales, scaleIds, mainCfg),
    [scales, scaleIds, mainCfg],
  );

  if (user === "loading") return <div className="p-6">Laden…</div>;
  if (!user)
    return (
      <div className="p-6">
        <Link className="text-blue-600 underline" href="/">
          Bitte einloggen
        </Link>
      </div>
    );
  if (!deviceId)
    return (
      <div className="p-6">
        <Link className="text-blue-600 underline" href="/">
          Kein Gerät gewählt
        </Link>
      </div>
    );

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            ← Geräte
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{deviceId}</h1>
        </div>
        <div className="text-right text-xs text-neutral-500">
          {device?.lastSeen && (
            <div>
              Zuletzt gesehen:{" "}
              {new Date(device.lastSeen).toLocaleString("de-DE")}
              <OnlineDot
                lastSeen={device.lastSeen}
                intervalSec={device.intervalSec}
              />
            </div>
          )}
          {device?.vBat !== undefined && (
            <div>Akku: {device.vBat.toFixed(2)} V</div>
          )}
          {device?.intervalSec && <div>Intervall: {device.intervalSec}s</div>}
        </div>
      </header>

      <nav className="mb-4 flex border-b border-neutral-200">
        <TopTab
          active={tab === "dashboard"}
          onClick={() => setTab("dashboard")}
        >
          Dashboard
        </TopTab>
        <TopTab active={tab === "scales"} onClick={() => setTab("scales")}>
          Waagen
          <span className="ml-1.5 text-xs text-neutral-400">
            ({scaleIds.length})
          </span>
        </TopTab>
        <TopTab
          active={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          Einstellungen
        </TopTab>
      </nav>

      {tab === "dashboard" && (
        <Dashboard
          readings={windowReadings}
          latest={current}
          scales={scales}
          scaleIds={scaleIds}
          mainCfg={mainCfg}
          dailyStats={dailyStats}
          onScaleClick={goToScale}
        />
      )}

      {tab === "scales" && (
        <section>
          <ul className="grid gap-3">
            {scaleIds.map((sid) => (
              <ScaleCard
                key={sid}
                anchorId={`scale-${sid}`}
                deviceId={deviceId}
                scaleId={sid}
                cfg={scales[sid] ?? { id: sid }}
                reading={current?.scales?.[sid]}
                readings={windowReadings}
                prefs={uiPrefs.get(sid)}
                pinOwners={pinOwners}
                comments={comments.filter((c) => c.scaleId === sid)}
                dailyStats={dailyStats}
                onPrefsChange={(patch) => uiPrefs.set(sid, patch)}
                onCalibrate={() => setWizardFor(sid)}
                onDelete={() => removeScale(deviceId, sid)}
              />
            ))}
          </ul>
          {scaleIds.length === 0 && (
            <p className="mb-3 rounded border border-dashed border-neutral-300 bg-white p-4 text-center text-sm text-neutral-500">
              Noch keine Waage konfiguriert. Mit „+ Waage hinzufügen“ legst
              du eine an. Der ESP übernimmt die Pin-Belegung beim nächsten
              Wakeup.
            </p>
          )}
          {scaleIds.length < MAX_SCALES && (
            <button
              type="button"
              onClick={() => addScale(deviceId, scaleIds, pinOwners)}
              className="mt-3 w-full rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-3 text-sm font-medium text-neutral-600 hover:border-neutral-500 hover:bg-neutral-50"
            >
              + Waage hinzufügen{" "}
              <span className="text-xs font-normal text-neutral-400">
                ({scaleIds.length}/{MAX_SCALES})
              </span>
            </button>
          )}
        </section>
      )}

      {tab === "settings" && (
        <SettingsPanel
          deviceId={deviceId}
          device={device}
          mainCfg={mainCfg}
          latest={latest}
          intervalSecFallback={device?.intervalSec}
          pinOwners={pinOwners}
        />
      )}

      {wizardFor && (
        <CalibrationWizard
          deviceId={deviceId}
          scale={scales[wizardFor] ?? { id: wizardFor }}
          latestRaw={current?.scales?.[wizardFor]?.raw}
          deepSleep={mainCfg.deepSleepEnabled ?? true}
          onClose={() => setWizardFor(null)}
        />
      )}
    </main>
  );
}
