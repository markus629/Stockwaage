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
  commentsCol,
  dailyStatsCol,
  deviceDoc,
  liveDoc,
  mainConfigDoc,
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
import OnlineDot from "@/components/OnlineDot";
import ScaleCard from "@/components/ScaleCard";
import SettingsPanel from "@/components/SettingsPanel";
import { useDeviceTab, useScaleUiPrefs } from "@/lib/uiPrefs";

// Rohdaten werden lazy pro Tab geladen (getDocs, kein Dauer-Listener); der
// aktuelle Messwert kommt live ueber `latest`/`live`.
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
  const uiPrefs = useScaleUiPrefs(deviceId);
  const [tab, setTab] = useDeviceTab(deviceId);

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
    : DEFAULT_STACK_DAYS;
  // Waagen-Tab: so viele Tage wie der groesste Stepper; Einstellungen: keine.
  const neededRawDays = tab === "scales" ? maxStackDays : 0;

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
            ← Übersicht
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
        <TopTab active={tab === "scales"} onClick={() => setTab("scales")}>
          Waage
        </TopTab>
        <TopTab
          active={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          Einstellungen
        </TopTab>
      </nav>

      {tab === "scales" && (
        <section>
          <ul className="grid gap-3">
            {(scaleIds.length ? scaleIds : ["s1"]).map((sid) => (
              <ScaleCard
                key={sid}
                deviceId={deviceId}
                scaleId={sid}
                cfg={scales[sid] ?? { id: sid }}
                reading={current?.scales?.[sid]}
                readings={windowReadings}
                prefs={uiPrefs.get(sid)}
                comments={comments.filter((c) => c.scaleId === sid)}
                dailyStats={dailyStats}
                feedStepThresholdKg={mainCfg.feedStepThresholdKg}
                onPrefsChange={(patch) => uiPrefs.set(sid, patch)}
                onCalibrate={() => setWizardFor(sid)}
                onDelete={() => removeScale(deviceId, sid)}
              />
            ))}
          </ul>
        </section>
      )}

      {tab === "settings" && (
        <SettingsPanel
          deviceId={deviceId}
          device={device}
          mainCfg={mainCfg}
          latest={latest}
          intervalSecFallback={device?.intervalSec}
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
