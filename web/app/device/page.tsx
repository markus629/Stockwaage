"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  deviceDoc,
  mainConfigDoc,
  readingsCol,
  scalesCol,
  updateMainConfig,
  updateScaleConfig,
  SCALE_IDS,
  type Device,
  type MainConfig,
  type Reading,
  type ScaleConfig,
} from "@/lib/devices";
import CalibrationWizard from "@/components/CalibrationWizard";
import LearningPhase from "@/components/LearningPhase";

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
  const [wizardFor, setWizardFor] = useState<string | null>(null);

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

  const tempAddrs = useMemo(
    () => (latest?.temps ? Object.keys(latest.temps) : []),
    [latest],
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
            Außensensor (für Temp-Kompensation)
            <select
              value={mainCfg.ambientTempAddr ?? ""}
              onChange={(e) =>
                updateMainConfig(deviceId, {
                  ambientTempAddr: e.target.value || undefined,
                })
              }
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            >
              <option value="">(automatischer Mittelwert)</option>
              {tempAddrs.map((a) => (
                <option key={a} value={a}>
                  {a} ({latest?.temps[a]?.toFixed(1)} °C)
                </option>
              ))}
            </select>
            {tempAddrs.length === 0 && (
              <p className="mt-1 text-xs text-neutral-500">
                Keine DS18B20 in letzter Messung. Sobald der ESP welche
                meldet, erscheinen sie hier.
              </p>
            )}
          </label>

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
        </div>
        {latest?.ambientC !== undefined && (
          <p className="mt-3 text-xs text-neutral-600">
            Aktuelle Außentemperatur:{" "}
            <span className="font-mono">{latest.ambientC.toFixed(2)} °C</span>
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Waagen
        </h2>
        <ul className="grid gap-3">
          {SCALE_IDS.map((sid) => {
            const cfg = scales[sid] ?? { id: sid };
            const reading = latest?.scales?.[sid];
            const calibrated = (cfg.scaleFactor ?? 0) !== 0;
            return (
              <li
                key={sid}
                className="rounded-lg border border-neutral-200 bg-white p-4"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cfg.enabled ?? false}
                      onChange={(e) =>
                        updateScaleConfig(deviceId, sid, {
                          enabled: e.target.checked,
                        })
                      }
                    />
                    <input
                      type="text"
                      value={cfg.name ?? ""}
                      placeholder={sid}
                      onChange={(e) =>
                        updateScaleConfig(deviceId, sid, {
                          name: e.target.value,
                        })
                      }
                      className="rounded border border-neutral-200 px-2 py-0.5 text-sm"
                    />
                    <span className="text-xs text-neutral-400">{sid}</span>
                  </div>
                  <button
                    onClick={() => setWizardFor(sid)}
                    className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-100"
                  >
                    Kalibrieren
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <span className="text-neutral-500">Rohwert</span>
                    <span className="text-right font-mono">
                      {reading?.raw !== undefined
                        ? reading.raw.toFixed(0)
                        : "—"}
                    </span>
                    <span className="text-neutral-500">Gewicht</span>
                    <span className="text-right font-mono">
                      {reading?.kg !== undefined
                        ? `${reading.kg.toFixed(2)} kg`
                        : calibrated
                          ? "—"
                          : "nicht kalibriert"}
                    </span>
                    <span className="text-neutral-500">Offset</span>
                    <span className="text-right font-mono">
                      {cfg.offset?.toFixed(0) ?? "0"}
                    </span>
                    <span className="text-neutral-500">Faktor</span>
                    <span className="text-right font-mono">
                      {cfg.scaleFactor?.toFixed(2) ?? "—"}
                    </span>
                  </div>
                  <LearningPhase deviceId={deviceId} scale={cfg} />
                </div>
              </li>
            );
          })}
        </ul>
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
