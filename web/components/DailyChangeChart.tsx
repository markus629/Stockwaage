"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyStat } from "@/lib/devices";

const FIXED_DAYS = 30;

type Props = {
  scaleId: string;
  stats: DailyStat[];
};

function formatDayLabel(key: string): string {
  const [, m, d] = key.split("-");
  return `${d}.${m}.`;
}

export default function DailyChangeChart({ scaleId, stats }: Props) {
  const data = useMemo(() => {
    // Tages-Schlussgewicht (last) je Tag aus den Aggregaten.
    const closeByDay = new Map<string, number>();
    for (const s of stats) {
      const agg = s.scales?.[scaleId];
      if (!agg || agg.count <= 0 || !isFinite(agg.last)) continue;
      closeByDay.set(s.date, agg.last);
    }
    const days = Array.from(closeByDay.keys()).sort();
    const out: Array<{ day: string; delta: number; close: number }> = [];
    for (let i = 1; i < days.length; i++) {
      const prev = closeByDay.get(days[i - 1])!;
      const cur = closeByDay.get(days[i])!;
      out.push({ day: days[i], delta: cur - prev, close: cur });
    }
    return out.slice(-FIXED_DAYS);
  }, [stats, scaleId]);

  if (data.length === 0) {
    return (
      <div className="mt-3 flex h-32 items-center justify-center rounded border border-dashed border-neutral-200 text-xs text-neutral-400">
        Noch nicht genug Tage für die Trendanzeige
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
        Eintrag pro Tag (Δ zum Vortag, letzte {FIXED_DAYS} Tage)
      </p>
      <div className="h-32 w-full">
        <ResponsiveContainer>
          <BarChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10 }}
              tickFormatter={formatDayLabel}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={42}
              tickFormatter={(v) => `${(v as number).toFixed(1)}`}
            />
            <Tooltip
              formatter={(value, _name, item) => {
                const n = Number(value);
                const close = (item as { payload?: { close?: number } })
                  ?.payload?.close;
                return [
                  `${n > 0 ? "+" : ""}${n.toFixed(2)} kg`,
                  close !== undefined ? `Gewicht ${close.toFixed(2)} kg` : "",
                ];
              }}
              labelFormatter={(v) => formatDayLabel(String(v))}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="delta" isAnimationActive={false}>
              {data.map((d) => (
                <Cell
                  key={d.day}
                  fill={d.delta >= 0 ? "#16a34a" : "#dc2626"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
