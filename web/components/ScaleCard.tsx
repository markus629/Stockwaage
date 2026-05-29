"use client";

import { useState } from "react";
import {
  ALLOWED_DT_PINS,
  DEFAULT_DT_PIN,
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
import DailyChangeChart from "./DailyChangeChart";
import LearningPhase from "./LearningPhase";
import PinSelect from "./PinSelect";
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
  pinOwners: Record<number, string>;
  comments: Comment[];
  dailyStats: DailyStat[];
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
  const pin = cfg.dtPin ?? DEFAULT_DT_PIN[cfg.id];
  if (pin) parts.push(`Pin ${pin}`);
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
  pinOwners,
  comments,
  dailyStats,
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
        <DebouncedInput
          type="text"
          value={cfg.name ?? ""}
          placeholder={scaleId}
          onClick={(e) => e.stopPropagation()}
          onCommit={(v) =>
            updateScaleConfig(deviceId, scaleId, { name: v })
          }
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
          aria-label={
            cfg.onDashboard ? "Vom Dashboard entfernen" : "Aufs Dashboard"
          }
          title={cfg.onDashboard ? "Vom Dashboard entfernen" : "Aufs Dashboard"}
          onClick={(e) => {
            e.stopPropagation();
            updateScaleConfig(deviceId, scaleId, {
              onDashboard: !cfg.onDashboard,
            });
          }}
          className={`rounded p-1 ${
            cfg.onDashboard
              ? "text-amber-500 hover:bg-amber-50"
              : "text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 1.5l2.6 5.3 5.9.86-4.25 4.14 1 5.85L10 14.77 4.75 17.65l1-5.85L1.5 7.66l5.9-.86L10 1.5z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={`Waage ${scaleId} löschen`}
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
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

      {prefs.cardOpen && (
        <div className="space-y-3 border-t border-neutral-200 bg-neutral-50/30 p-3">
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
                  {prefs.configTab === "pin" && (
                    <PinPanel
                      deviceId={deviceId}
                      scaleId={scaleId}
                      cfg={cfg}
                      pinOwners={pinOwners}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          <ScaleChart
            scaleId={scaleId}
            readings={readings}
            days={prefs.stackDays}
            onDaysChange={(n) => onPrefsChange({ stackDays: n })}
          />
          <DailyChangeChart scaleId={scaleId} stats={dailyStats} />
          <ScaleLongTermChart
            scaleId={scaleId}
            stats={dailyStats}
            comments={comments}
          />
          <CommentsSection
            deviceId={deviceId}
            scaleId={scaleId}
            comments={comments}
          />
        </div>
      )}
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
    { id: "pin", label: "Pin" },
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

function PinPanel({
  deviceId,
  scaleId,
  cfg,
  pinOwners,
}: {
  deviceId: string;
  scaleId: string;
  cfg: ScaleConfig;
  pinOwners: Record<number, string>;
}) {
  const currentPin = cfg.dtPin ?? DEFAULT_DT_PIN[scaleId];
  return (
    <div className="text-sm">
      <label className="block">
        <span className="text-xs text-neutral-500">HX711 DT-Pin (GPIO)</span>
        <PinSelect
          value={currentPin}
          allowed={ALLOWED_DT_PINS}
          pinOwners={pinOwners}
          ownerKey={scaleId}
          defaultMarker={DEFAULT_DT_PIN[scaleId]}
          onChange={(v) => updateScaleConfig(deviceId, scaleId, { dtPin: v })}
        />
      </label>
      <p className="mt-2 text-xs text-neutral-500">
        SCK liegt fest auf GPIO 4 (alle Waagen teilen sich SCK). Pin-Änderung
        wirkt beim nächsten ESP-Wakeup.
      </p>
    </div>
  );
}
