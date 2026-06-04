import { linearRegression, type DailyStat } from "./devices";

// ============================================================================
// Futter-Prognose – rein clientseitig aus vorhandenen Daten (dailyStats).
// ============================================================================


// ----- Futter-Reichweite ----------------------------------------------------
//
// Modell: Der Imker erfasst, wieviel Futter er gibt (feedReserveKg ab einem
// Baseline-Gewicht). Den Verbrauch misst die Waage – als mittlere taegliche
// Gewichtsaenderung SEIT der letzten Fuetterung (saubere Steigung ohne den
// Futter-Sprung). Daraus: verbleibendes Futter / Verbrauch = Reichweite.

// Fallback-Fenster (Tage), wenn keine Baseline gesetzt ist.
export const FORECAST_LOOKBACK_DAYS = 21;
// Tagesaenderungen groesser als das gelten als Eingriff (Fuettern, Fuetterer
// abnehmen, Durchsicht) und zaehlen NICHT zum Verbrauch.
export const FEED_STEP_THRESHOLD_KG = 1.0;

export type FeedInput = {
  baselineKg?: number; // feedBaselineKg = 0-Futter-Referenz
  baselineAt?: number; // ms – ab hier Verbrauch messen
  currentKg?: number; // aktuelles Waagengewicht (kg)
  stepThresholdKg?: number; // Sprung-Schwelle (Default FEED_STEP_THRESHOLD_KG)
};

export type FeedForecast = {
  dailyChangeKg: number | null; // Verbrauch/Tag (negativ = zehrt); null = zu wenig Daten
  remainingKg: number | null; // verbleibendes Futter = aktuell − Baseline; null = keine Baseline
  daysLeft: number | null; // Tage bis Futter aufgebraucht; null wenn nicht bestimmbar
  basisDays: number; // Anzahl gewerteter Tagesaenderungen
};

function localDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function forecastFeed(
  dailyStats: DailyStat[],
  scaleId: string,
  feed?: FeedInput,
): FeedForecast | null {
  const series = dailyStats
    .map((d) => ({ date: d.date, last: d.scales?.[scaleId]?.last }))
    .filter((d): d is { date: string; last: number } =>
      typeof d.last === "number" && isFinite(d.last),
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Verbleibendes Futter = aktuelles Gewicht − Baseline.
  let remainingKg: number | null = null;
  if (
    feed &&
    typeof feed.baselineKg === "number" &&
    typeof feed.currentKg === "number"
  ) {
    remainingKg = Math.max(0, feed.currentKg - feed.baselineKg);
  }

  // Verbrauchsfenster: ab Baseline (sonst 21 Tage).
  const used =
    feed?.baselineAt != null
      ? series.filter((d) => d.date >= localDay(feed.baselineAt!))
      : series.slice(-FORECAST_LOOKBACK_DAYS);

  // Tag-zu-Tag-Aenderungen: grosse Spruenge (Eingriffe) ignorieren, die
  // kleinen mitteln -> robuster Zehr-Trend (Rauschen hebt sich auf).
  const threshold = feed?.stepThresholdKg ?? FEED_STEP_THRESHOLD_KG;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < used.length; i++) {
    const delta = used[i].last - used[i - 1].last;
    if (Math.abs(delta) > threshold) continue; // Eingriff -> raus
    sum += delta;
    n++;
  }
  const dailyChangeKg = n > 0 ? sum / n : null;

  if (remainingKg === null && dailyChangeKg === null) return null;

  const daysLeft =
    remainingKg !== null && dailyChangeKg !== null && dailyChangeKg < 0
      ? remainingKg / -dailyChangeKg
      : null;

  return { dailyChangeKg, remainingKg, daysLeft, basisDays: n };
}
