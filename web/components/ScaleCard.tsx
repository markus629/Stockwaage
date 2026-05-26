"use client";

import {
  ALLOWED_DT_PINS,
  DEFAULT_DT_PIN,
  updateScaleConfig,
  type Reading,
  type ScaleConfig,
  type ScaleReading,
} from "@/lib/devices";
import type { ConfigTab, ScaleUiPrefs } from "@/lib/uiPrefs";
import LearningPhase from "./LearningPhase";
import ScaleChart from "./ScaleChart";

type Props = {
  deviceId: string;
  scaleId: string;
  cfg: ScaleConfig;
  reading: ScaleReading | undefined;
  readings: Reading[];
  prefs: ScaleUiPrefs;
  pinOwners: Record<number, string>;
  onPrefsChange: (patch: Partial<ScaleUiPrefs>) => void;
  onCalibrate: () => void;
  onDelete: () => void;
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
  deviceId,
  scaleId,
  cfg,
  reading,
  readings,
  prefs,
  pinOwners,
  onPrefsChange,
  onCalibrate,
  onDelete,
}: Props) {
  const calibrated = (cfg.scaleFactor ?? 0) !== 0;
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
          className={`font-mono ${
            reading?.kg !== undefined ? "text-base" : "text-xs text-neutral-400"
          }`}
        >
          {weightLabel}
        </span>
        <button
          type="button"
          aria-label={`Waage ${scaleId} löschen`}
          onClick={(e) => {
            e.stopPropagation();
            if (
              confirm(
                `Waage ${cfg.name || scaleId} wirklich entfernen?\n\n` +
                  `Historische Messwerte bleiben in Firestore erhalten.`,
              )
            ) {
              onDelete();
            }
          }}
          className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5 9h10v2H5z" />
          </svg>
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

          <ScaleChart scaleId={scaleId} readings={readings} />
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
        <select
          value={currentPin ?? ""}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) updateScaleConfig(deviceId, scaleId, { dtPin: v });
          }}
          className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          {ALLOWED_DT_PINS.map((p) => {
            const owner = pinOwners[p];
            const takenByOther = owner && owner !== scaleId;
            return (
              <option key={p} value={p} disabled={!!takenByOther}>
                GPIO {p}
                {DEFAULT_DT_PIN[scaleId] === p ? " (Standard)" : ""}
                {takenByOther ? ` — belegt von ${owner}` : ""}
              </option>
            );
          })}
        </select>
      </label>
      <p className="mt-2 text-xs text-neutral-500">
        SCK liegt fest auf GPIO 4 (alle Waagen teilen sich SCK). Pin-Änderung
        wirkt beim nächsten ESP-Wakeup.
      </p>
    </div>
  );
}
