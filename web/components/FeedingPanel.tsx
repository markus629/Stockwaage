"use client";

import { useState } from "react";
import { forecastFeed } from "@/lib/analysis";
import {
  addComment,
  clearFeedTracking,
  logFeeding,
  type DailyStat,
  type ScaleConfig,
} from "@/lib/devices";

type Props = {
  deviceId: string;
  scaleId: string;
  cfg: ScaleConfig;
  currentKg?: number; // aktuelles Waagengewicht (kg)
  dailyStats: DailyStat[];
};

// Futter-Erfassung: "X kg gefüttert" eingeben -> wird auf das verbleibende
// Futter addiert und über den gemessenen Verbrauch heruntergerechnet.
export default function FeedingPanel({
  deviceId,
  scaleId,
  cfg,
  currentKg,
  dailyStats,
}: Props) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tracking =
    typeof cfg.feedReserveKg === "number" &&
    typeof cfg.feedBaselineKg === "number";

  const fc = forecastFeed(dailyStats, scaleId, {
    reserveKg: cfg.feedReserveKg,
    baselineKg: cfg.feedBaselineKg,
    sinceTs: cfg.feedUpdatedAt,
    currentKg,
  });
  const remaining = fc?.remainingKg ?? null;

  async function submit() {
    const x = parseFloat(amount.replace(",", "."));
    if (!isFinite(x) || x <= 0) {
      setError("Bitte eine Menge > 0 eingeben.");
      return;
    }
    if (typeof currentKg !== "number") {
      setError(
        "Die Waage zeigt gerade kein kg (kalibriert? Messwert vorhanden?).",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logFeeding(deviceId, scaleId, x, currentKg, remaining ?? 0);
      // Als Marker ins Logbuch.
      await addComment(deviceId, scaleId, `${x} kg Futter gefüttert`);
      setAmount("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm("Futter-Erfassung zurücksetzen (neue Saison)?")) return;
    setBusy(true);
    try {
      await clearFeedTracking(deviceId, scaleId);
    } finally {
      setBusy(false);
    }
  }

  const days = fc?.daysLeft != null ? Math.round(fc.daysLeft) : null;

  return (
    <div className="mt-3">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
        Fütterung
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          step="0.1"
          min="0"
          value={amount}
          placeholder="z.B. 10"
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="w-20 rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !amount}
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          kg gefüttert
        </button>

        {tracking && remaining !== null && (
          <span className="text-sm">
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

        {tracking && (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
          >
            Zurücksetzen
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-neutral-500">
        {!tracking
          ? "Noch kein Futter erfasst. Gefütterte Menge eintragen, dann zählt die Waage den Verbrauch herunter."
          : days != null
            ? "Restmenge & Reichweite bei aktuellem Verbrauch."
            : fc?.dailyChangeKg == null
              ? "Verbrauch wird noch ermittelt (ein paar Tage Messdaten nötig)."
              : "Derzeit kein Verbrauch (Gewicht steigt/konstant)."}
      </p>

      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
