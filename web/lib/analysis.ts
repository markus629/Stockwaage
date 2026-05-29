import { linearRegression, type DailyStat, type Reading } from "./devices";

// ============================================================================
// Ereignis-Erkennung & Prognosen – rein clientseitig aus vorhandenen Daten.
// Kein Server, kein zusaetzlicher Firestore-Read.
// ============================================================================

// ----- Schwarm-Erkennung ----------------------------------------------------

// Ploetzlicher Gewichtssturz = Schwarm abgegangen. Schwellen bewusst grob:
// > 1,5 kg Verlust innerhalb von 30 Minuten.
export const SWARM_DROP_KG = 1.5;
export const SWARM_WINDOW_MS = 30 * 60 * 1000;

export type SwarmResult = {
  swarm: boolean;
  dropKg: number; // groesster Sturz im betrachteten Zeitraum (kg, positiv)
  atTs?: number; // Zeitpunkt des Sturzes
  samples: number; // Anzahl auswertbarer kg-Messpunkte
};

// Sucht im (beliebig sortierten) Messwert-Array einer Waage nach dem
// groessten Gewichtsabfall innerhalb eines SWARM_WINDOW_MS-Fensters.
export function detectSwarm(
  readings: Reading[],
  scaleId: string,
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
    // Fenster vorne beschneiden (alles aelter als 30 min vor pts[i]).
    while (pts[head].ts < pts[i].ts - SWARM_WINDOW_MS) {
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

  return { swarm: worst >= SWARM_DROP_KG, dropKg: worst, atTs, samples: pts.length };
}

// ----- Winterfutter-Prognose ------------------------------------------------

// Mittlere Tagesaenderung aus den letzten 3 Wochen (dailyStats) hochrechnen.
export const FORECAST_LOOKBACK_DAYS = 21;

export type FeedForecast = {
  currentKg: number; // letztes bekanntes Tagesschlussgewicht
  dailyChangeKg: number; // mittlere Aenderung pro Tag (negativ = Verbrauch)
  daysLeft: number | null; // Tage bis 0 kg; null wenn kein Verbrauch (Zunahme)
  basisDays: number; // Anzahl Tage in der Berechnung
};

// Schaetzt per linearer Regression ueber die letzten FORECAST_LOOKBACK_DAYS
// die taegliche Gewichtsaenderung und rechnet hoch, wie lange das Futter
// (das aktuelle Gewicht) bei diesem Verbrauch noch reicht.
export function forecastFeed(
  dailyStats: DailyStat[],
  scaleId: string,
): FeedForecast | null {
  const series = dailyStats
    .map((d) => ({ date: d.date, last: d.scales?.[scaleId]?.last }))
    .filter((d): d is { date: string; last: number } =>
      typeof d.last === "number" && isFinite(d.last),
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (series.length < 2) return null;
  const window = series.slice(-FORECAST_LOOKBACK_DAYS);
  if (window.length < 2) return null;

  const t0 = Date.parse(window[0].date);
  const reg = linearRegression(
    window.map((d) => ({
      x: (Date.parse(d.date) - t0) / 86_400_000, // Tage seit Fensterbeginn
      y: d.last,
    })),
  );
  if (!reg) return null;

  const dailyChangeKg = reg.slope; // kg pro Tag
  const currentKg = window[window.length - 1].last;
  const daysLeft = dailyChangeKg < 0 ? currentKg / -dailyChangeKg : null;

  return { currentKg, dailyChangeKg, daysLeft, basisDays: window.length };
}
