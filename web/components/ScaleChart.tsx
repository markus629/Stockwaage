"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Reading } from "@/lib/devices";
import { STACK_DAY_STEPS } from "@/lib/uiPrefs";

type Props = {
  scaleId: string;
  readings: Reading[];
  days?: number; // Anzahl gestapelter Tage; ohne -> alle in readings
  onDaysChange?: (n: number) => void; // gesetzt -> Stepper anzeigen
  baselineKg?: number; // Futter-Baseline als horizontale Linie
  showBaseline?: boolean;
};

function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hoursOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function colorForAge(ageIdx: number, total: number): string {
  if (total <= 1) return "rgb(239,68,68)";
  const t = ageIdx / (total - 1);
  return `rgb(${lerp(239, 59, t)},${lerp(68, 130, t)},${lerp(68, 246, t)})`;
}

function widthForAge(ageIdx: number, total: number): number {
  if (total <= 1) return 2.5;
  const t = ageIdx / (total - 1);
  return 2.5 - t * 1.5;
}

function formatDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
}

export default function ScaleChart({
  scaleId,
  readings,
  days,
  onDaysChange,
  baselineKg,
  showBaseline,
}: Props) {
  const baseOn =
    !!showBaseline && typeof baselineKg === "number" && isFinite(baselineKg);
  const { data, dayKeys } = useMemo(() => {
    const cutoff =
      days === undefined
        ? -Infinity
        : (() => {
            const start = new Date();
            start.setHours(0, 0, 0, 0);
            return start.getTime() - (days - 1) * 86_400_000;
          })();
    const points: Array<{ kg: number; day: string; minute: number; hour: number }> = [];
    for (const r of readings) {
      if (r.ts < cutoff) continue;
      const kg = r.scales?.[scaleId]?.kg;
      if (kg === undefined || kg === null || !isFinite(kg)) continue;
      const hour = hoursOfDay(r.ts);
      points.push({
        kg,
        day: localDayKey(r.ts),
        minute: Math.round(hour * 60),
        hour,
      });
    }
    if (points.length === 0) return { data: [], dayKeys: [] };

    const keys = Array.from(new Set(points.map((p) => p.day))).sort((a, b) =>
      a < b ? 1 : -1,
    );

    const byMinute = new Map<number, Record<string, number>>();
    for (const p of points) {
      let row = byMinute.get(p.minute);
      if (!row) {
        row = { hour: p.hour };
        byMinute.set(p.minute, row);
      }
      row[p.day] = p.kg;
    }
    const arr = Array.from(byMinute.values()).sort(
      (a, b) => (a.hour as number) - (b.hour as number),
    );
    return { data: arr, dayKeys: keys };
  }, [readings, scaleId, days]);

  const idx = STACK_DAY_STEPS.indexOf(
    (days ?? 7) as (typeof STACK_DAY_STEPS)[number],
  );
  const curIdx = idx < 0 ? STACK_DAY_STEPS.indexOf(7) : idx;
  const stepper = !onDaysChange ? null : (
    <div className="mb-1 flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">
        Tagesverlauf
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="weniger Tage"
          disabled={curIdx <= 0}
          onClick={() => onDaysChange?.(STACK_DAY_STEPS[curIdx - 1])}
          className="rounded border border-neutral-300 px-1.5 leading-none text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
        >
          ‹
        </button>
        <span className="min-w-[3.5rem] text-center text-xs font-medium tabular-nums">
          {days} {days === 1 ? "Tag" : "Tage"}
        </span>
        <button
          type="button"
          aria-label="mehr Tage"
          disabled={curIdx >= STACK_DAY_STEPS.length - 1}
          onClick={() => onDaysChange?.(STACK_DAY_STEPS[curIdx + 1])}
          className="rounded border border-neutral-300 px-1.5 leading-none text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </div>
  );

  if (data.length === 0) {
    return (
      <div className="mt-3">
        {stepper}
        <div className="flex h-32 items-center justify-center rounded border border-dashed border-neutral-200 text-xs text-neutral-400">
          Noch keine Verlaufsdaten
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {stepper}
      <div className="h-40 w-full">
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis
              dataKey="hour"
              type="number"
              domain={[0, 24]}
              ticks={[0, 6, 12, 18, 24]}
              tickFormatter={(v) => `${v}h`}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={42}
              domain={["auto", "auto"]}
              tickFormatter={(v) => (v as number).toFixed(1)}
            />
            {baseOn && (
              <ReferenceLine
                y={baselineKg}
                stroke="#16a34a"
                strokeDasharray="5 4"
                ifOverflow="extendDomain"
                label={{
                  value: "Baseline",
                  position: "insideBottomRight",
                  fontSize: 10,
                  fill: "#16a34a",
                }}
              />
            )}
            <Tooltip
              formatter={(value, name) => [
                `${Number(value).toFixed(2)} kg`,
                formatDayLabel(String(name)),
              ]}
              labelFormatter={(v) => {
                const num = Number(v);
                const h = Math.floor(num);
                const m = Math.round((num - h) * 60);
                return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} Uhr`;
              }}
              contentStyle={{ fontSize: 12 }}
            />
            {dayKeys.map((day, idx) => (
              <Line
                key={day}
                type="monotone"
                dataKey={day}
                stroke={colorForAge(idx, dayKeys.length)}
                strokeWidth={widthForAge(idx, dayKeys.length)}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-neutral-500">
        {dayKeys.map((day, idx) => (
          <span key={day} className="flex items-center gap-1">
            <span
              className="inline-block h-0.5 w-3"
              style={{
                background: colorForAge(idx, dayKeys.length),
                height: `${widthForAge(idx, dayKeys.length)}px`,
              }}
            />
            {formatDayLabel(day)}
          </span>
        ))}
      </div>
    </div>
  );
}
