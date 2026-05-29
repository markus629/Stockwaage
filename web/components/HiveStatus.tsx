"use client";

import { useMemo } from "react";
import {
  detectSwarm,
  forecastFeed,
  type FeedForecast,
  type SwarmResult,
} from "@/lib/analysis";
import type { DailyStat, Reading, ScaleConfig } from "@/lib/devices";

type Props = {
  readings: Reading[]; // bereits aufs Dashboard-Fenster gefiltert
  dailyStats: DailyStat[];
  scales: Record<string, ScaleConfig>;
  scaleIds: string[];
};

type SwarmProps = Props & {
  dropKg: number;
  windowMin: number;
};

function nameOf(scales: Record<string, ScaleConfig>, sid: string): string {
  return scales[sid]?.name || sid;
}

function Dot({ color }: { color: "green" | "red" | "grey" }) {
  const cls =
    color === "red"
      ? "bg-red-500"
      : color === "green"
        ? "bg-green-500"
        : "bg-neutral-300";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls}`}
      aria-hidden
    />
  );
}

function fmtWhen(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ----- Schwarm-Alarm --------------------------------------------------------

export function SwarmAlarmTile({
  readings,
  scales,
  scaleIds,
  dropKg,
  windowMin,
}: SwarmProps) {
  const rows = useMemo(
    () =>
      scaleIds.map((sid) => ({
        sid,
        name: nameOf(scales, sid),
        res: detectSwarm(readings, sid, dropKg, windowMin * 60 * 1000),
      })),
    [readings, scaleIds, scales, dropKg, windowMin],
  );

  const anyAlarm = rows.some((r) => r.res.swarm);

  return (
    <section
      className={`rounded-lg border bg-white p-3 sm:col-span-2 ${
        anyAlarm ? "border-red-300" : "border-neutral-200"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Schwarm-Alarm</h3>
        <span className="text-xs text-neutral-400">
          {anyAlarm ? "⚠️ Schwarm möglich" : "alles ruhig"}
        </span>
      </div>
      <ul className="divide-y divide-neutral-100">
        {rows.map(({ sid, name, res }) => (
          <SwarmRow key={sid} name={name} sid={sid} res={res} />
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-neutral-400">
        Roter Punkt = plötzlicher Gewichtssturz (&gt; {dropKg} kg in &lt;{" "}
        {windowMin} min) in den letzten Tagen. Grün = unauffällig. Schwellen in
        den Einstellungen anpassbar.
      </p>
    </section>
  );
}

function SwarmRow({
  name,
  sid,
  res,
}: {
  name: string;
  sid: string;
  res: SwarmResult;
}) {
  const noData = res.samples < 2;
  const color = noData ? "grey" : res.swarm ? "red" : "green";
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <Dot color={color} />
      <span className="min-w-0 flex-1 truncate">
        {name}
        {name !== sid && (
          <span className="ml-1 text-xs text-neutral-400">{sid}</span>
        )}
      </span>
      <span
        className={`shrink-0 text-xs ${
          res.swarm ? "font-medium text-red-600" : "text-neutral-500"
        }`}
      >
        {noData
          ? "keine Daten"
          : res.swarm
            ? `−${res.dropKg.toFixed(1)} kg · ${fmtWhen(res.atTs)}`
            : "ok"}
      </span>
    </li>
  );
}

// ----- Winterfutter-Prognose ------------------------------------------------

export function FeedForecastTile({ dailyStats, scales, scaleIds }: Props) {
  const rows = useMemo(
    () =>
      scaleIds.map((sid) => ({
        sid,
        name: nameOf(scales, sid),
        fc: forecastFeed(dailyStats, sid),
      })),
    [dailyStats, scaleIds, scales],
  );

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-3 sm:col-span-2">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Futter-Reichweite</h3>
        <span className="text-xs text-neutral-400">Ø der letzten 3 Wochen</span>
      </div>
      <ul className="divide-y divide-neutral-100">
        {rows.map(({ sid, name, fc }) => (
          <ForecastRow key={sid} name={name} sid={sid} fc={fc} />
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-neutral-400">
        Hochrechnung aus dem mittleren Tagesverbrauch. Nur ein grober Anhalt –
        Tracht, Brut und Wetter ändern den Verbrauch.
      </p>
    </section>
  );
}

function ForecastRow({
  name,
  sid,
  fc,
}: {
  name: string;
  sid: string;
  fc: FeedForecast | null;
}) {
  let detail: React.ReactNode;
  if (!fc) {
    detail = <span className="text-xs text-neutral-400">zu wenig Tage</span>;
  } else if (fc.daysLeft === null) {
    // Gewicht steigt -> kein Verbrauch (Tracht/Fütterung).
    detail = (
      <span className="text-xs text-green-600">
        +{(fc.dailyChangeKg * 1000).toFixed(0)} g/Tag · nimmt zu
      </span>
    );
  } else {
    const days = Math.round(fc.daysLeft);
    const urgent = days < 14;
    detail = (
      <span className={`text-xs ${urgent ? "font-medium text-red-600" : "text-neutral-600"}`}>
        {(fc.dailyChangeKg * 1000).toFixed(0)} g/Tag · reicht ~{days}{" "}
        {days === 1 ? "Tag" : "Tage"}
      </span>
    );
  }
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate">
        {name}
        {name !== sid && (
          <span className="ml-1 text-xs text-neutral-400">{sid}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-xs text-neutral-400">
        {fc ? `${fc.currentKg.toFixed(1)} kg` : "—"}
      </span>
      {detail}
    </li>
  );
}
