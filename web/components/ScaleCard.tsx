"use client";

import { useState } from "react";
import {
  updateScaleConfig,
  type Comment,
  type DailyStat,
  type Reading,
  type ScaleConfig,
  type ScaleReading,
} from "@/lib/devices";
import type { ConfigTab, ScaleUiPrefs } from "@/lib/uiPrefs";
import CommentsSection from "./CommentsSection";
import DebouncedInput from "./DebouncedInput";
import FeedingPanel from "./FeedingPanel";
import LiveWeight from "./LiveWeight";
import DailyChangeChart from "./DailyChangeChart";
import LearningPhase from "./LearningPhase";
import ScaleChart from "./ScaleChart";
import ScaleLongTermChart from "./ScaleLongTermChart";

type Props = {
  anchorId?: string;
  deviceId: string;
  scaleId: string;
  cfg: ScaleConfig;
  reading: ScaleReading | undefined;
  readings: Reading[];
  prefs: ScaleUiPrefs;
  comments: Comment[];
  dailyStats: DailyStat[];
  feedStepThresholdKg?: number;
  onPrefsChange: (patch: Partial<ScaleUiPrefs>) => void;
  onCalibrate: () => void;
  onDelete: () => void | Promise<void>;
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

function configSummary(cfg: ScaleConfig): string {
  const parts: string[] = [];
  if (cfg.scaleFactor && cfg.scaleFactor !== 0) {
    parts.push(`Faktor ${cfg.scaleFactor.toFixed(2)}`);
  } else {
    parts.push("nicht kalibriert");
  }
  if (cfg.tempCoef && cfg.tempCoef !== 0) {
    parts.push(`${cfg.tempCoef.toFixed(2)} raw/°C`);
  }
  return parts.join(" · ");
}

export default function ScaleCard({
  anchorId,
  deviceId,
  scaleId,
  cfg,
  reading,
  readings,
  prefs,
  comments,
  dailyStats,
  feedStepThresholdKg,
  onPrefsChange,
  onCalibrate,
  onDelete,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const calibrated = (cfg.scaleFactor ?? 0) !== 0;
  const weightLabel =
    reading?.kg !== undefined
      ? `${reading.kg.toFixed(2)} kg`
      : calibrated
        ? "—"
        : "nicht kalibriert";

  async function handleDelete() {
    const name = cfg.name || scaleId;
    if (
      !confirm(
        `Waage „${name}" wirklich löschen?\n\n` +
          `Dabei werden UNWIDERRUFLICH gelöscht:\n` +
          `• alle Messwerte dieser Waage (Verlauf + Tagesdaten)\n` +
          `• alle Logbuch-Kommentare dieser Waage\n` +
          `• die Kalibrierung & Pin-Konfiguration\n\n` +
          `Andere Waagen bleiben unberührt. Bei vielen Messwerten kann ` +
          `das einige Sekunden dauern.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (e) {
      alert(
        "Löschen fehlgeschlagen: " +
          (e instanceof Error ? e.message : String(e)),
      );
      setDeleting(false);
    }
  }

  return (
    <li
      id={anchorId}
      className="scroll-mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2.5">
        <DebouncedInput
          type="text"
          value={cfg.name ?? ""}
          placeholder={scaleId}
          onCommit={(v) => updateScaleConfig(deviceId, scaleId, { name: v })}
          className="min-w-[100px] flex-1 rounded border border-neutral-200 px-2 py-0.5 text-sm"
        />
        <span className="text-xs text-neutral-400">{scaleId}</span>
        <span
          className={`font-mono ${
            reading?.kg !== undefined ? "text-base" : "text-xs text-neutral-400"
          }`}
        >
          {weightLabel}
        </span>
        <button
          type="button"
          aria-label={`Waage ${scaleId} löschen`}
          disabled={deleting}
          onClick={handleDelete}
          className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          {deleting ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              className="animate-spin"
              fill="none"
            >
              <circle
                cx="10"
                cy="10"
                r="7"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="33"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5 9h10v2H5z" />
            </svg>
          )}
        </button>
      </div>

      <div className="space-y-3 bg-neutral-50/30 p-3">
          <div className="rounded border border-neutral-200 bg-white">
            <button
              type="button"
              onClick={() => onPrefsChange({ configOpen: !prefs.configOpen })}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-neutral-50"
            >
              <Chevron open={prefs.configOpen} />
              Konfiguration
              <span className="ml-auto truncate text-xs font-normal text-neutral-500">
                {configSummary(cfg)}
              </span>
            </button>
            {prefs.configOpen && (
              <div className="border-t border-neutral-200">
                <Tabs
                  active={prefs.configTab}
                  onChange={(t) => onPrefsChange({ configTab: t })}
                />
                <div className="p-3">
                  {prefs.configTab === "calib" && (
                    <CalibPanel
                      cfg={cfg}
                      reading={reading}
                      onCalibrate={onCalibrate}
                    />
                  )}
                  {prefs.configTab === "temp" && (
                    <LearningPhase deviceId={deviceId} scale={cfg} />
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded border border-neutral-200 bg-white px-3 py-2">
            <LiveWeight reading={reading} />
          </div>

          <ScaleChart
            scaleId={scaleId}
            readings={readings}
            days={prefs.stackDays}
            onDaysChange={(n) => onPrefsChange({ stackDays: n })}
            baselineKg={cfg.feedBaselineKg}
            showBaseline={cfg.feedBaselineVisible}
          />
          <DailyChangeChart scaleId={scaleId} stats={dailyStats} />
          <ScaleLongTermChart
            scaleId={scaleId}
            stats={dailyStats}
            comments={comments}
          />
          <FeedingPanel
            deviceId={deviceId}
            scaleId={scaleId}
            cfg={cfg}
            currentKg={reading?.kg}
            dailyStats={dailyStats}
            stepThresholdKg={feedStepThresholdKg}
          />
          <CommentsSection
            deviceId={deviceId}
            scaleId={scaleId}
            comments={comments}
          />
        </div>
    </li>
  );
}

function Tabs({
  active,
  onChange,
}: {
  active: ConfigTab;
  onChange: (t: ConfigTab) => void;
}) {
  const tabs: { id: ConfigTab; label: string }[] = [
    { id: "calib", label: "Kalibrierung" },
    { id: "temp", label: "Temperatur" },
  ];
  return (
    <div className="flex border-b border-neutral-200 bg-neutral-50">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition ${
            active === t.id
              ? "border-b-2 border-neutral-900 bg-white text-neutral-900"
              : "text-neutral-500 hover:text-neutral-900"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CalibPanel({
  cfg,
  reading,
  onCalibrate,
}: {
  cfg: ScaleConfig;
  reading: ScaleReading | undefined;
  onCalibrate: () => void;
}) {
  return (
    <div className="text-sm">
      <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <span className="text-neutral-500">Rohwert</span>
        <span className="text-right font-mono">
          {reading?.raw !== undefined ? reading.raw.toFixed(0) : "—"}
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
  );
}

