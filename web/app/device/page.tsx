"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
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
  deviceDoc,
  mainConfigDoc,
  MAX_SCALES,
  readingsCol,
  removeScale,
  scalesCol,
  updateMainConfig,
  type Device,
  type MainConfig,
  type Reading,
  type ScaleConfig,
} from "@/lib/devices";
import CalibrationWizard from "@/components/CalibrationWizard";
import ScaleCard from "@/components/ScaleCard";
import { useScaleUiPrefs } from "@/lib/uiPrefs";

const DAYS_DEFAULT = 7;
const DAYS_MIN = 1;
const DAYS_MAX = 30;

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Laden…</div>}>
      <DeviceDetail />
    </Suspense>
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
  const [windowReadings, setWindowReadings] = useState<Reading[]>([]);
  const [wizardFor, setWizardFor] = useState<string | null>(null);
  const [days, setDays] = useState<number>(DAYS_DEFAULT);
  const uiPrefs = useScaleUiPrefs(deviceId);

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
    return () => unsubs.forEach((u) => u());
  }, [user, deviceId]);

  useEffect(() => {
    if (!user || user === "loading" || !deviceId) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const cutoff = start.getTime() - (days - 1) * 24 * 3600 * 1000;
    const unsub = onSnapshot(
      query(
        readingsCol(deviceId),
        where("ts", ">=", cutoff),
        orderBy("ts", "asc"),
      ),
      (snap) => {
        setWindowReadings(snap.docs.map((d) => d.data() as Reading));
      },
    );
    return () => unsub();
  }, [user, deviceId, days]);

  const scaleIds = useMemo(
    () => Object.keys(scales).sort((a, b) => a.localeCompare(b)),
    [scales],
  );

  const pinOwners = useMemo(() => {
    const map: Record<number, string> = {};
    for (const sid of scaleIds) {
      const pin = scales[sid]?.dtPin;
      if (typeof pin === "number" && pin > 0 && map[pin] === undefined) {
        map[pin] = sid;
      }
    }
    return map;
  }, [scaleIds, scales]);

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
            </div>
          )}
          {device?.vBat !== undefined && (
            <div>Akku: {device.vBat.toFixed(2)} V</div>
          )}
          {device?.intervalSec && <div>Intervall: {device.intervalSec}s</div>}
        </div>
      </header>

      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Geräte-Einstellungen
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Mess-Intervall (Sekunden)
            <input
              type="number"
              min={30}
              step={30}
              value={mainCfg.intervalSec ?? device?.intervalSec ?? ""}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 30) {
                  updateMainConfig(deviceId, { intervalSec: v });
                }
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              Wirkt ab nächstem ESP-Wakeup.
            </span>
          </label>

          <label className="text-sm">
            Verlauf: Anzahl Tage ({DAYS_MIN}–{DAYS_MAX})
            <input
              type="number"
              min={DAYS_MIN}
              max={DAYS_MAX}
              value={days}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v))
                  setDays(Math.max(DAYS_MIN, Math.min(DAYS_MAX, v)));
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            />
            <span className="mt-1 block text-xs text-neutral-500">
              Heute = rot/dick, älteste = blau/dünn.
            </span>
          </label>
        </div>
        {(latest?.ambientC !== undefined ||
          latest?.ambientHumidity !== undefined) && (
          <p className="mt-3 text-xs text-neutral-600">
            Aktuell:{" "}
            {latest?.ambientC !== undefined && (
              <span className="font-mono">
                {latest.ambientC.toFixed(1)} °C
              </span>
            )}
            {latest?.ambientC !== undefined &&
              latest?.ambientHumidity !== undefined &&
              " · "}
            {latest?.ambientHumidity !== undefined && (
              <span className="font-mono">
                {latest.ambientHumidity.toFixed(0)} % rF
              </span>
            )}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Waagen
        </h2>
        <ul className="grid gap-3">
          {scaleIds.map((sid) => (
            <ScaleCard
              key={sid}
              deviceId={deviceId}
              scaleId={sid}
              cfg={scales[sid] ?? { id: sid }}
              reading={latest?.scales?.[sid]}
              readings={windowReadings}
              prefs={uiPrefs.get(sid)}
              pinOwners={pinOwners}
              onPrefsChange={(patch) => uiPrefs.set(sid, patch)}
              onCalibrate={() => setWizardFor(sid)}
              onDelete={() => removeScale(deviceId, sid)}
            />
          ))}
        </ul>
        {scaleIds.length === 0 && (
          <p className="mb-3 rounded border border-dashed border-neutral-300 bg-white p-4 text-center text-sm text-neutral-500">
            Noch keine Waage konfiguriert. Mit „+ Waage hinzufügen“ legst du
            eine an. Der ESP übernimmt die Pin-Belegung beim nächsten Wakeup.
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

      {wizardFor && (
        <CalibrationWizard
          deviceId={deviceId}
          scale={scales[wizardFor] ?? { id: wizardFor }}
          latestRaw={latest?.scales?.[wizardFor]?.raw}
          onClose={() => setWizardFor(null)}
        />
      )}
    </main>
  );
}
