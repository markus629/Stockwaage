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
import { todayDelta } from "@/lib/analysis";
import type { ConfigTab, ScaleUiPrefs } from "@/lib/uiPrefs";
import CommentsSection from "./CommentsSection";
import DebouncedInput from "./DebouncedInput";
import FeedingPanel from "./FeedingPanel";
import DailyChangeChart from "./DailyChangeChart";
import LearningPhase from "./LearningPhase";
import ScaleChart from "./ScaleChart";
import ScaleLongTermChart from "./ScaleLongTermChart";

type Props = {
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
  // S3-Bienenstand: Pin-/Aktiv-Einstellungen, gerendert in der Konfiguration.
  pinConfig?: React.ReactNode;
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
  pinConfig,
}: Props) {
  const calibrated = (cfg.scaleFactor ?? 0) !== 0;
  const kg = reading?.kg;
  const hasKg = typeof kg === "number" && isFinite(kg);
  const delta = todayDelta(dailyStats, scaleId, hasKg ? kg : undefined);
  const disabled = cfg.enabled === false;

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      {/* Kopf: Name + Slot */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-2.5">
        <DebouncedInput
          type="text"
          value={cfg.name ?? ""}
          placeholder={scaleId}
          onCommit={(v) => updateScaleConfig(deviceId, scaleId, { name: v })}
          className="min-w-[110px] flex-1 rounded-md border border-transparent px-2 py-0.5 text-sm font-medium hover:border-neutral-200 focus:border-neutral-300 focus:outline-none"
        />
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
          {scaleId}
        </span>
        {disabled && (
          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
            deaktiviert
          </span>
        )}
      </div>

      <div className="space-y-4 p-4">
        {/* Hero: aktuelles Gewicht + Tagestrend */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400">
              Aktuell
            </div>
            {hasKg ? (
              <div className="font-mono text-3xl font-bold tabular-nums leading-tight">
                {kg!.toFixed(2)}
                <span className="ml-1 text-base font-medium text-neutral-400">
                  kg
                </span>
              </div>
            ) : (
              <div className="text-lg text-neutral-400">
                {calibrated ? "—" : "nicht kalibriert"}
              </div>
            )}
          </div>
          {delta !== null && (
            <div
              className={`mb-1 flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${
                delta >= 0
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-600"
              }`}
              title="Veränderung seit dem letzten Tagesabschluss"
            >
              {delta >= 0 ? "▲" : "▼"} {delta >= 0 ? "+" : ""}
              {delta.toFixed(2)} kg heute
            </div>
          )}
          {reading?.raw !== undefined && (
            <span className="mb-1.5 ml-auto font-mono text-[11px] text-neutral-300 tabular-nums">
              raw {reading.raw.toFixed(0)}
            </span>
          )}
        </div>

        {/* Graphen – das Zentrum der Karte */}
        <ScaleChart
          scaleId={scaleId}
          readings={readings}
          days={prefs.stackDays}
          onDaysChange={(n) => onPrefsChange({ stackDays: n })}
          baselineKg={cfg.feedBaselineKg}
          showBaseline={cfg.feedBaselineVisible}
        />
        <ScaleLongTermChart
          scaleId={scaleId}
          stats={dailyStats}
          comments={comments}
        />
        <DailyChangeChart scaleId={scaleId} stats={dailyStats} />

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

        {/* Konfiguration – bewusst zuletzt (einmalige Einrichtung) */}
        <div className="rounded-lg border border-neutral-200">
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
              <div className="space-y-3 p-3">
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
                {pinConfig}
                <DeleteScaleButton
                  name={cfg.name || scaleId}
                  onDelete={onDelete}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteScaleButton({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => void | Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
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
    <button
      type="button"
      disabled={deleting}
      onClick={handleDelete}
      className="w-full rounded border border-red-200 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {deleting ? "Lösche…" : "Waage löschen…"}
    </button>
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
              ? "border-b-2 border-amber-500 bg-white text-neutral-900"
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
