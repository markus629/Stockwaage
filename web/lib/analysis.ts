import { linearRegression, type DailyStat, type Reading } from "./devices";

// ============================================================================
// Ereignis-Erkennung & Prognosen – rein clientseitig aus vorhandenen Daten.
// Kein Server, kein zusaetzlicher Firestore-Read.
// ============================================================================

// ----- Schwarm-Erkennung ----------------------------------------------------

// Ploetzlicher Gewichtssturz = Schwarm abgegangen. Standardschwellen (in den
// Einstellungen ueberschreibbar): > 1,5 kg Verlust innerhalb von 30 Minuten.
export const SWARM_DROP_KG = 1.5;
export const SWARM_WINDOW_MIN = 30;
export const SWARM_WINDOW_MS = SWARM_WINDOW_MIN * 60 * 1000;

export type SwarmResult = {
  swarm: boolean;
  dropKg: number; // groesster Sturz im betrachteten Zeitraum (kg, positiv)
  atTs?: number; // Zeitpunkt des Sturzes
  samples: number; // Anzahl auswertbarer kg-Messpunkte
};

// Sucht im (beliebig sortierten) Messwert-Array einer Waage nach dem
// groessten Gewichtsabfall innerhalb des Zeitfensters. Schwellen sind
// parametrisierbar (kommen aus den Geraete-Einstellungen).
export function detectSwarm(
  readings: Reading[],
  scaleId: string,
  dropKg: number = SWARM_DROP_KG,
  windowMs: number = SWARM_WINDOW_MS,
): SwarmResult {
  const pts = readings
    .map((r) => ({ ts: r.ts, kg: r.scales?.[scaleId]?.kg }))
    .filter((p): p is { ts: number; kg: number } =>
      typeof p.kg === "number" && isFinite(p.kg),
    )
    .sort((a, b) => a.ts - b.ts);

  let worst = 0;
  let atTs: number | undefined;
  let head = 0;
  let maxInWindow = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    // Fenster vorne beschneiden (alles aelter als windowMs vor pts[i]).
    while (pts[head].ts < pts[i].ts - windowMs) {
      head++;
      // Maximum im Fenster ggf. neu bestimmen, wenn der Spitzenwert rausfiel.
      maxInWindow = -Infinity;
      for (let j = head; j <= i; j++) {
        if (pts[j].kg > maxInWindow) maxInWindow = pts[j].kg;
      }
    }
    if (pts[i].kg > maxInWindow) maxInWindow = pts[i].kg;
    const drop = maxInWindow - pts[i].kg;
    if (drop > worst) {
      worst = drop;
      atTs = pts[i].ts;
    }
  }

  return { swarm: worst >= dropKg, dropKg: worst, atTs, samples: pts.length };
}

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
