"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  ALLOWED_DT_PINS,
  DEFAULT_DT_PIN,
  addScale,
  commentsCol,
  computePinOwners,
  dailyStatsCol,
  deviceDoc,
  liveDoc,
  readingsCol,
  removeScale,
  scaleSlotLabel,
  scalesCol,
  updateScaleConfig,
  type Comment,
  type DailyStat,
  type Device,
  type MainConfig,
  type Reading,
  type ScaleConfig,
} from "@/lib/devices";
import { updateDevice } from "@/lib/devices";
import CalibrationWizard from "./CalibrationWizard";
import DebouncedInput from "./DebouncedInput";
import HiveLogo from "./HiveLogo";
import KeepAwakeControl from "./KeepAwakeControl";
import OnlineDot from "./OnlineDot";
import PinSelect from "./PinSelect";
import ScaleCard from "./ScaleCard";
import VitalChips from "./VitalChips";
import { useScaleUiPrefs } from "@/lib/uiPrefs";

const DEFAULT_STACK_DAYS = 7;

// Floating-Window eines S3-Bienenstands: mehrere Waagen (je eine ScaleCard mit
// Graphen + individuellem HX711-DT-Pin), Waagen per +/- hinzufuegen/entfernen.
// Hardware/Sensoren + Verhalten sind global (Einstellungen-Tab); hier kommen
// die globalen Werte (inkl. SCK fuer Pin-Kollisionen) via mainCfg.
export default function HiveDetailModal({
  deviceId,
  defaultName,
  mainCfg,
  onClose,
}: {
  deviceId: string;
  defaultName: string;
  mainCfg: MainConfig;
  onClose: () => void;
}) {
  const [device, setDevice] = useState<Device | null>(null);
  const [scales, setScales] = useState<Record<string, ScaleConfig>>({});
  const [latest, setLatest] = useState<Reading | null>(null);
  const [live, setLive] = useState<Reading | null>(null);
  const [windowReadings, setWindowReadings] = useState<Reading[]>([]);
  const [loadedRawDays, setLoadedRawDays] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [dailyLoaded, setDailyLoaded] = useState(false);
  const [wizardFor, setWizardFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Lokaler "Wach halten"-Status dieses Stands (ms-Epoch; 0 = schlaeft).
  const [awakeUntil, setAwakeUntil] = useState(0);
  const uiPrefs = useScaleUiPrefs(deviceId);

  useEffect(() => {
    const unsubs: Array<() => void> = [
      onSnapshot(deviceDoc(deviceId), (s) =>
        setDevice(s.exists() ? ({ id: s.id, ...s.data() } as Device) : null),
      ),
      onSnapshot(scalesCol(deviceId), (snap) => {
        const map: Record<string, ScaleConfig> = {};
        for (const d of snap.docs) {
          map[d.id] = { id: d.id, ...(d.data() as Omit<ScaleConfig, "id">) };
        }
        setScales(map);
      }),
      onSnapshot(
        query(readingsCol(deviceId), orderBy("ts", "desc"), limit(1)),
        (snap) => setLatest((snap.docs[0]?.data() as Reading) ?? null),
      ),
      onSnapshot(liveDoc(deviceId), (s) =>
        setLive(s.exists() ? (s.data() as Reading) : null),
      ),
      onSnapshot(commentsCol(deviceId), (snap) =>
        setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Comment)),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [deviceId]);

  const scaleIds = useMemo(
    () => Object.keys(scales).sort((a, b) => a.localeCompare(b)),
    [scales],
  );
  const pinOwners = useMemo(
    () => computePinOwners(scales, scaleIds, mainCfg),
    [scales, scaleIds, mainCfg],
  );
  const current = useMemo<Reading | null>(
    () =>
      live && (!latest || (live.ts ?? 0) >= (latest.ts ?? 0)) ? live : latest,
    [live, latest],
  );

  const maxStackDays = scaleIds.length
    ? Math.max(
        ...scaleIds.map((sid) => uiPrefs.get(sid).stackDays ?? DEFAULT_STACK_DAYS),
      )
    : DEFAULT_STACK_DAYS;

  useEffect(() => {
    if (maxStackDays <= loadedRawDays) return;
    let cancelled = false;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const cutoff = start.getTime() - (maxStackDays - 1) * 86_400_000;
    getDocs(
      query(readingsCol(deviceId), where("ts", ">=", cutoff), orderBy("ts", "asc")),
    ).then((snap) => {
      if (cancelled) return;
      setWindowReadings(snap.docs.map((d) => d.data() as Reading));
      setLoadedRawDays(maxStackDays);
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId, maxStackDays, loadedRawDays]);

  useEffect(() => {
    if (dailyLoaded) return;
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
  }, [deviceId, dailyLoaded]);

  async function handleAddScale() {
    setAdding(true);
    try {
      await addScale(deviceId, scaleIds, pinOwners);
    } finally {
      setAdding(false);
    }
  }

  const deepSleep = awakeUntil <= Date.now();

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl rounded-2xl bg-stone-50 p-4 shadow-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kopf: Identitaet + Vitalwerte des Stands */}
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100">
            <HiveLogo variant="multi" className="h-9 w-9" />
          </div>
          <div className="min-w-0 flex-1">
            <DebouncedInput
              type="text"
              value={device?.name ?? ""}
              placeholder={defaultName}
              onCommit={(v) => updateDevice(deviceId, { name: v.trim() })}
              className="w-full rounded-md border border-transparent px-1.5 py-0.5 text-lg font-bold hover:border-neutral-200 focus:border-amber-300 focus:outline-none"
            />
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1.5 text-xs text-neutral-500">
              <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                Bienenstand · S3 · {scaleIds.length}{" "}
                {scaleIds.length === 1 ? "Waage" : "Waagen"}
              </span>
              <span className="font-mono text-[10px] text-neutral-400">
                {deviceId}
              </span>
              {device?.lastSeen && (
                <span className="flex items-center">
                  zuletzt {new Date(device.lastSeen).toLocaleString("de-DE")}
                  <OnlineDot
                    lastSeen={device.lastSeen}
                    intervalSec={device.intervalSec}
                  />
                </span>
              )}
            </div>
            <div className="px-1.5">
              <VitalChips device={device} reading={current} />
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="shrink-0 rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
          >
            ✕
          </button>
        </div>

        {mainCfg.bme280Enabled !== true && (
          <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <span className="font-semibold">
              ⚠️ Temperatursensor (BMP280) ist deaktiviert
            </span>
            <span className="mt-0.5 block text-xs text-amber-800">
              Alle Waagen dieses Bienenstands werden über einen gemeinsamen
              BMP280 temperatur-kompensiert. Ohne ihn ist kein zuverlässiges
              Wiegen möglich – im Einstellungen-Tab aktivieren.
            </span>
          </div>
        )}

        <div className="mb-3">
          <KeepAwakeControl
            deviceId={deviceId}
            awakeUntil={awakeUntil}
            onChange={setAwakeUntil}
          />
        </div>

        <div className="space-y-3">
          {scaleIds.length === 0 && (
            <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500">
              Noch keine Waage angelegt. Füge unten eine hinzu und wähle ihren
              HX711-DT-Pin (in der Konfiguration der Waage).
            </p>
          )}

          {scaleIds.map((sid) => {
            const cfg = scales[sid] ?? { id: sid };
            return (
              <ScaleCard
                key={sid}
                deviceId={deviceId}
                scaleId={sid}
                cfg={cfg}
                reading={current?.scales?.[sid]}
                readings={windowReadings}
                prefs={uiPrefs.get(sid)}
                comments={comments.filter((c) => c.scaleId === sid)}
                dailyStats={dailyStats}
                feedStepThresholdKg={mainCfg.feedStepThresholdKg}
                namePlaceholder={scaleSlotLabel(sid)}
                onPrefsChange={(patch) => uiPrefs.set(sid, patch)}
                onCalibrate={() => setWizardFor(sid)}
                onDelete={async () => {
                  await removeScale(deviceId, sid);
                }}
                pinConfig={
                  <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                      <input
                        type="checkbox"
                        checked={cfg.enabled ?? true}
                        onChange={(e) =>
                          updateScaleConfig(deviceId, sid, {
                            enabled: e.target.checked,
                          })
                        }
                      />
                      Waage aktiv
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                      HX711 DT-Pin
                      <PinSelect
                        value={cfg.dtPin ?? DEFAULT_DT_PIN[sid] ?? 0}
                        allowed={ALLOWED_DT_PINS}
                        onChange={(v) =>
                          updateScaleConfig(deviceId, sid, { dtPin: v })
                        }
                        pinOwners={pinOwners}
                        ownerKey={sid}
                        defaultMarker={DEFAULT_DT_PIN[sid]}
                        className="rounded border border-neutral-300 px-2 py-1 text-sm"
                      />
                    </label>
                  </div>
                }
              />
            );
          })}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddScale}
              disabled={adding || scaleIds.length >= 8}
              className="flex-1 rounded-xl border border-dashed border-neutral-300 bg-white px-3 py-2.5 text-sm font-medium text-neutral-600 transition hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
            >
              {adding ? "…" : "+ Waage"}
            </button>
            <button
              type="button"
              onClick={async () => {
                const last = scaleIds[scaleIds.length - 1];
                if (!last) return;
                if (
                  !confirm(
                    `Letzte Waage (${scales[last]?.name || last}) entfernen? ` +
                      `Kalibrierung und Messwerte dieser Waage werden gelöscht.`,
                  )
                )
                  return;
                await removeScale(deviceId, last);
              }}
              disabled={scaleIds.length === 0}
              className="flex-1 rounded-xl border border-dashed border-neutral-300 bg-white px-3 py-2.5 text-sm font-medium text-neutral-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
            >
              − Letzte Waage
            </button>
          </div>

          <p className="text-[11px] text-neutral-400">
            Hardware/Sensoren (BMP280, INA219, Regen, Wake-Button, SCK/I2C)
            gelten für alle Bienenstände gemeinsam und stehen unter
            Einstellungen. Hier: Waagen-Anzahl, DT-Pin und Kalibrierung je
            Waage.
          </p>
        </div>

        {wizardFor && (
          <CalibrationWizard
            deviceId={deviceId}
            scale={scales[wizardFor] ?? { id: wizardFor }}
            latestRaw={current?.scales?.[wizardFor]?.raw}
            deepSleep={deepSleep}
            onClose={() => setWizardFor(null)}
          />
        )}
      </div>
    </div>
  );
}
