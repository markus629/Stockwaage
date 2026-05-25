"use client";

import {
  updateScaleConfig,
  type Reading,
  type ScaleConfig,
  type ScaleReading,
} from "@/lib/devices";
import LearningPhase from "./LearningPhase";
import ScaleChart from "./ScaleChart";

export type ScaleUiPrefs = {
  cardOpen: boolean;
  calibOpen: boolean;
  tempOpen: boolean;
};

export const DEFAULT_SCALE_PREFS: ScaleUiPrefs = {
  cardOpen: true,
  calibOpen: false,
  tempOpen: false,
};

type Props = {
  deviceId: string;
  scaleId: string;
  cfg: ScaleConfig;
  reading: ScaleReading | undefined;
  readings: Reading[];
  prefs: ScaleUiPrefs;
  onPrefsChange: (patch: Partial<ScaleUiPrefs>) => void;
  onCalibrate: () => void;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      style={{
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
        transition: "transform 0.15s",
      }}
      className="shrink-0 text-neutral-500"
    >
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

export default function ScaleCard({
  deviceId,
  scaleId,
  cfg,
  reading,
  readings,
  prefs,
  onPrefsChange,
  onCalibrate,
}: Props) {
  const calibrated = (cfg.scaleFactor ?? 0) !== 0;
  const hasTempModel =
    cfg.tempCoef !== undefined && cfg.tempCoef !== null && cfg.tempCoef !== 0;

  const weightLabel =
    reading?.kg !== undefined
      ? `${reading.kg.toFixed(2)} kg`
      : calibrated
        ? "—"
        : "nicht kalibriert";

  return (
    <li className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onPrefsChange({ cardOpen: !prefs.cardOpen })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPrefsChange({ cardOpen: !prefs.cardOpen });
          }
        }}
        className="flex flex-wrap items-center gap-2 px-3 py-2.5 cursor-pointer select-none hover:bg-neutral-50"
      >
        <Chevron open={prefs.cardOpen} />
        <input
          type="text"
          value={cfg.name ?? ""}
          placeholder={scaleId}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            updateScaleConfig(deviceId, scaleId, { name: e.target.value })
          }
          className="min-w-[100px] flex-1 rounded border border-neutral-200 px-2 py-0.5 text-sm"
        />
        <span className="text-xs text-neutral-400">{scaleId}</span>
        <span
          className={`ml-auto font-mono ${
            reading?.kg !== undefined ? "text-base" : "text-xs text-neutral-400"
          }`}
        >
          {weightLabel}
        </span>
      </div>

      {prefs.cardOpen && (
        <div className="space-y-3 border-t border-neutral-200 bg-neutral-50/30 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-neutral-200 bg-white">
              <button
                type="button"
                onClick={() => onPrefsChange({ calibOpen: !prefs.calibOpen })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-neutral-50"
              >
                <Chevron open={prefs.calibOpen} />
                Kalibrierung
                <span className="ml-auto text-xs font-normal text-neutral-500">
                  {calibrated
                    ? `Faktor ${cfg.scaleFactor!.toFixed(2)}`
                    : "noch nicht"}
                </span>
              </button>
              {prefs.calibOpen && (
                <div className="border-t border-neutral-200 px-3 py-2 text-sm">
                  <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span className="text-neutral-500">Rohwert</span>
                    <span className="text-right font-mono">
                      {reading?.raw !== undefined
                        ? reading.raw.toFixed(0)
                        : "—"}
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
                  <button
                    onClick={onCalibrate}
                    className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
                  >
                    Kalibrieren…
                  </button>
                </div>
              )}
            </div>

            <div className="rounded border border-neutral-200 bg-white">
              <button
                type="button"
                onClick={() => onPrefsChange({ tempOpen: !prefs.tempOpen })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-neutral-50"
              >
                <Chevron open={prefs.tempOpen} />
                Temperaturkompensation
                <span className="ml-auto text-xs font-normal text-neutral-500">
                  {cfg.learning
                    ? "lernt…"
                    : hasTempModel
                      ? `${cfg.tempCoef!.toFixed(2)} raw/°C`
                      : "nicht gelernt"}
                </span>
              </button>
              {prefs.tempOpen && (
                <div className="border-t border-neutral-200 px-3 py-2">
                  <LearningPhase deviceId={deviceId} scale={cfg} />
                </div>
              )}
            </div>
          </div>

          <ScaleChart scaleId={scaleId} readings={readings} />
        </div>
      )}
    </li>
  );
}
