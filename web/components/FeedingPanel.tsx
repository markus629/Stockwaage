"use client";

import { useState } from "react";
import { FEED_STEP_THRESHOLD_KG, forecastFeed } from "@/lib/analysis";
import {
  addComment,
  setFeedBaseline,
  updateScaleConfig,
  type DailyStat,
  type ScaleConfig,
} from "@/lib/devices";
import DebouncedInput from "./DebouncedInput";

type Props = {
  deviceId: string;
  scaleId: string;
  cfg: ScaleConfig;
  currentKg?: number; // aktuelles Waagengewicht (kg)
  dailyStats: DailyStat[];
};

// Futter-Tracker: "Baseline" merkt sich das aktuelle Gewicht als 0-Futter.
// Restmenge = aktuell − Baseline; Verbrauch = gefilterte Tagesaenderung.
export default function FeedingPanel({
  deviceId,
  scaleId,
  cfg,
  currentKg,
  dailyStats,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState(false);

  const tracking = typeof cfg.feedBaselineKg === "number";
  const fc = forecastFeed(dailyStats, scaleId, {
    baselineKg: cfg.feedBaselineKg,
    baselineAt: cfg.feedBaselineAt,
    currentKg,
    stepThresholdKg: cfg.feedStepThresholdKg,
  });
  const remaining = fc?.remainingKg ?? null;
  const days = fc?.daysLeft != null ? Math.round(fc.daysLeft) : null;

  async function setBaseline() {
    if (typeof currentKg !== "number") {
      setError("Die Waage zeigt gerade kein kg (kalibriert? Messwert da?).");
      return;
    }
    if (
      tracking &&
      !confirm(
        "Neue Baseline auf das aktuelle Gewicht setzen? Der Futter-Nullpunkt " +
          "wird damit zurückgesetzt.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await setFeedBaseline(deviceId, scaleId, currentKg);
      await addComment(
        deviceId,
        scaleId,
        `Futter-Baseline gesetzt (${currentKg.toFixed(1)} kg)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">
          Futtertracker
        </span>
        <button
          type="button"
          aria-label="Wie funktioniert der Futtertracker?"
          title="Info"
          onClick={() => setInfo(true)}
          className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-300 text-[10px] font-semibold text-neutral-500 hover:bg-neutral-100"
        >
          i
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={setBaseline}
          disabled={busy || typeof currentKg !== "number"}
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {tracking ? "Baseline neu setzen" : "Baseline setzen"}
        </button>

        <label className="flex items-center gap-1 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={!!cfg.feedBaselineVisible}
            disabled={!tracking}
            onChange={(e) =>
              updateScaleConfig(deviceId, scaleId, {
                feedBaselineVisible: e.target.checked,
              })
            }
          />
          Baseline im Graph
        </label>

        {tracking && remaining !== null && (
          <span className="ml-auto text-sm">
            <span className="font-mono font-semibold tabular-nums">
              {remaining.toFixed(1)} kg
            </span>
            {days != null && (
              <span
                className={
                  days < 14 ? "font-medium text-red-600" : "text-neutral-500"
                }
              >
                {" "}
                · ~{days} {days === 1 ? "Tag" : "Tage"}
              </span>
            )}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-neutral-500">
        {!tracking
          ? "Vor dem Füttern „Baseline setzen“ – ab dann gilt alles über der Baseline als Futter."
          : days != null
            ? "Restmenge (aktuell − Baseline) & Reichweite beim gemessenen Verbrauch."
            : fc?.dailyChangeKg == null
              ? "Verbrauch wird noch ermittelt (ein paar Tage Messdaten nötig)."
              : "Derzeit kein Verbrauch (Gewicht steigt/konstant)."}
      </p>

      {tracking && (
        <label className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
          Sprünge ignorieren ab
          <DebouncedInput
            type="number"
            step="0.1"
            min="0.1"
            value={cfg.feedStepThresholdKg ?? FEED_STEP_THRESHOLD_KG}
            onCommit={(raw) => {
              const v = parseFloat(raw.replace(",", "."));
              if (isFinite(v) && v > 0)
                updateScaleConfig(deviceId, scaleId, { feedStepThresholdKg: v });
            }}
            className="w-14 rounded border border-neutral-300 px-1 py-0.5 text-center"
          />
          kg/Tag
        </label>
      )}

      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}

      {info && <FeedInfo onClose={() => setInfo(false)} />}
    </div>
  );
}

function FeedInfo({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">So funktioniert der Futtertracker</h3>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <ul className="space-y-2 text-sm text-neutral-700">
          <li>
            <strong>Baseline setzen:</strong> Markiert das aktuelle Gewicht als
            Futter-Nullpunkt. Am besten <em>vor</em> dem Füttern drücken.
          </li>
          <li>
            <strong>Restmenge</strong> = aktuelles Gewicht − Baseline. Alles, was
            du oben drauf gibst, ist Futter; was die Bienen zehren, geht runter.
            Nachfüttern wird automatisch mitgezählt – ohne weitere Eingabe.
          </li>
          <li>
            <strong>Reichweite</strong> = Restmenge ÷ täglicher Verbrauch.
          </li>
          <li>
            <strong>Verbrauch</strong> wird ab der Baseline gemessen. Große
            Sprünge (Füttern, Fütterer abnehmen, Durchsicht) werden gefiltert,
            die kleinen Tagesänderungen gemittelt – so bleibt der echte
            Zehr-Trend. Die Schwelle dafür ist einstellbar.
          </li>
          <li>
            <strong>Baseline im Graph:</strong> blendet die Linie im
            Gewichtsverlauf ein/aus – so siehst du auf einen Blick, wie weit du
            noch über dem Nullpunkt bist.
          </li>
          <li>
            <strong>Neue Saison:</strong> einfach erneut „Baseline neu setzen“.
          </li>
        </ul>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700"
        >
          Verstanden
        </button>
      </div>
    </div>
  );
}
