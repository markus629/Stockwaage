"use client";

import {
  detectSwarm,
  forecastFeed,
} from "@/lib/analysis";
import type { DailyStat, Reading } from "@/lib/devices";

// Kompakte Status-Zeilen, die innerhalb der Pro-Waage-Kachel auf dem
// Dashboard unter dem Graph angezeigt werden. Beide rein clientseitig.

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

// ----- Schwarm-Alarm (eine Waage) -------------------------------------------

export function ScaleSwarmStatus({
  readings,
  scaleId,
  dropKg,
  windowMin,
}: {
  readings: Reading[];
  scaleId: string;
  dropKg: number;
  windowMin: number;
}) {
  const res = detectSwarm(readings, scaleId, dropKg, windowMin * 60 * 1000);
  const noData = res.samples < 2;
  const color = noData ? "grey" : res.swarm ? "red" : "green";
  return (
    <div className="flex items-center gap-2 text-xs">
      <Dot color={color} />
      <span className="text-neutral-500">Schwarm-Alarm</span>
      <span
        className={`ml-auto text-right ${
          res.swarm ? "font-medium text-red-600" : "text-neutral-600"
        }`}
      >
        {noData
          ? "keine Daten"
          : res.swarm
            ? `−${res.dropKg.toFixed(1)} kg · ${fmtWhen(res.atTs)}`
            : "ruhig"}
      </span>
    </div>
  );
}

// ----- Futter-Reichweite (eine Waage) ---------------------------------------

export function ScaleFeedStatus({
  dailyStats,
  scaleId,
}: {
  dailyStats: DailyStat[];
  scaleId: string;
}) {
  const fc = forecastFeed(dailyStats, scaleId);
  let value: React.ReactNode;
  if (!fc) {
    value = <span className="text-neutral-400">zu wenig Tage</span>;
  } else if (fc.daysLeft === null) {
    value = (
      <span className="text-green-600">
        +{(fc.dailyChangeKg * 1000).toFixed(0)} g/Tag · nimmt zu
      </span>
    );
  } else {
    const days = Math.round(fc.daysLeft);
    const urgent = days < 14;
    value = (
      <span className={urgent ? "font-medium text-red-600" : "text-neutral-600"}>
        {(fc.dailyChangeKg * 1000).toFixed(0)} g/Tag · reicht ~{days}{" "}
        {days === 1 ? "Tag" : "Tage"}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-neutral-500">Futter-Reichweite</span>
      <span className="ml-auto text-right">{value}</span>
    </div>
  );
}
