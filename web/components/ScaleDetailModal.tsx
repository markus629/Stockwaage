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
  commentsCol,
  dailyStatsCol,
  deviceDoc,
  liveDoc,
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
import CalibrationWizard from "./CalibrationWizard";
import OnlineDot from "./OnlineDot";
import ScaleCard from "./ScaleCard";
import { useScaleUiPrefs } from "@/lib/uiPrefs";

const DEFAULT_STACK_DAYS = 7;

// Floating-Window mit der Detailansicht einer Waage: Konfiguration/Kalibrierung,
// Charts, Futter-Tracker und Logbuch. Globale Einstellungen kommen via mainCfg.
export default function ScaleDetailModal({
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
  const [wizardOpen, setWizardOpen] = useState(false);
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
  const current = useMemo<Reading | null>(
    () =>
      live && (!latest || (live.ts ?? 0) >= (latest.ts ?? 0)) ? live : latest,
    [live, latest],
  );

  const sid = scaleIds.length ? scaleIds[0] : "s1";
  const cfg = scales[sid] ?? { id: sid };
  const maxStackDays = uiPrefs.get(sid).stackDays ?? DEFAULT_STACK_DAYS;

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
            <h2 className="text-lg font-semibold">{cfg.name || deviceId}</h2>
            <div className="text-xs text-neutral-500">
              {deviceId}
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

        <ul>
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
            onCalibrate={() => setWizardOpen(true)}
            onDelete={async () => {
              await removeScale(deviceId, sid);
              onClose();
            }}
          />
        </ul>

        {wizardOpen && (
          <CalibrationWizard
            deviceId={deviceId}
            scale={cfg}
            latestRaw={current?.scales?.[sid]?.raw}
            deepSleep={mainCfg.deepSleepEnabled ?? true}
            onClose={() => setWizardOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
