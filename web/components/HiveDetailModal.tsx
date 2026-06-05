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
  scalesCol,
  updateScaleConfig,
  type Comment,
  type DailyStat,
  type Device,
  type MainConfig,
  type Reading,
  type ScaleConfig,
} from "@/lib/devices";
import CalibrationWizard from "./CalibrationWizard";
import OnlineDot from "./OnlineDot";
import PinSelect from "./PinSelect";
import ScaleCard from "./ScaleCard";
import { useScaleUiPrefs } from "@/lib/uiPrefs";

const DEFAULT_STACK_DAYS = 7;

// Floating-Window eines S3-Bienenstands: mehrere Waagen (je eine ScaleCard mit
// Graphen + individuellem HX711-DT-Pin), Waagen per +/- hinzufuegen/entfernen.
// Hardware/Sensoren + Verhalten sind global (Einstellungen-Tab); hier kommen
// die globalen Werte (inkl. SCK fuer Pin-Kollisionen) via mainCfg.
export default function HiveDetailModal({
  deviceId,
  mainCfg,
  onClose,
}: {
  deviceId: string;
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

  const deepSleep = mainCfg.deepSleepEnabled ?? true;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">🐝 {deviceId}</h2>
            <div className="text-xs text-neutral-500">
              Bienenstand · {scaleIds.length}{" "}
              {scaleIds.length === 1 ? "Waage" : "Waagen"}
              {device?.lastSeen && (
                <>
                  {" · zuletzt "}
                  {new Date(device.lastSeen).toLocaleString("de-DE")}
                  <OnlineDot
                    lastSeen={device.lastSeen}
                    intervalSec={device.intervalSec}
                  />
                </>
              )}
              {device?.vBat !== undefined && <> · {device.vBat.toFixed(2)} V</>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-neutral-500">
            Hardware/Sensoren (BMP280, INA219, Regen, Wake-Button, SCK/I2C)
            gelten für alle S3 gemeinsam und stehen unter{" "}
            <strong>Einstellungen</strong>. Hier legst du nur fest, wie viele
            Waagen dieser Bienenstand hat und welcher DT-Pin zu welcher gehört.
          </p>
            {scaleIds.length === 0 && (
              <p className="text-sm text-neutral-500">
                Noch keine Waage angelegt. Füge unten eine hinzu und wähle ihren
                HX711-DT-Pin.
              </p>
            )}
            <ul className="space-y-3">
              {scaleIds.map((sid) => {
                const cfg = scales[sid] ?? { id: sid };
                return (
                  <li key={sid} id={`scale-${sid}`} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
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
                        aktiv
                      </label>
                      <span className="text-xs text-neutral-500">DT-Pin</span>
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
                    </div>
                    <ScaleCard
                      deviceId={deviceId}
                      scaleId={sid}
                      cfg={cfg}
                      reading={current?.scales?.[sid]}
                      readings={windowReadings}
                      prefs={uiPrefs.get(sid)}
                      comments={comments.filter((c) => c.scaleId === sid)}
                      dailyStats={dailyStats}
                      feedStepThresholdKg={mainCfg.feedStepThresholdKg}
                      onPrefsChange={(patch) => uiPrefs.set(sid, patch)}
                      onCalibrate={() => setWizardFor(sid)}
                      onDelete={async () => {
                        await removeScale(deviceId, sid);
                      }}
                    />
                  </li>
                );
              })}
            </ul>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddScale}
                disabled={adding || scaleIds.length >= 8}
                className="flex-1 rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
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
                className="flex-1 rounded border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                − Letzte Waage
              </button>
            </div>
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
