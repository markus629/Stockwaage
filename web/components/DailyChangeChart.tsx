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
import type { Reading } from "@/lib/devices";

type Props = {
  scaleId: string;
  readings: Reading[];
};

function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(key: string): string {
  const [, m, d] = key.split("-");
  return `${d}.${m}.`;
}

export default function DailyChangeChart({ scaleId, readings }: Props) {
  const data = useMemo(() => {
    // Letzten Wert pro Tag bestimmen.
    const lastByDay = new Map<string, { ts: number; kg: number }>();
    for (const r of readings) {
      const kg = r.scales?.[scaleId]?.kg;
      if (kg === undefined || kg === null || !isFinite(kg)) continue;
      const day = localDayKey(r.ts);
      const prev = lastByDay.get(day);
      if (!prev || r.ts > prev.ts) lastByDay.set(day, { ts: r.ts, kg });
    }
    const days = Array.from(lastByDay.keys()).sort();
    const out: Array<{ day: string; delta: number; close: number }> = [];
    for (let i = 1; i < days.length; i++) {
      const prev = lastByDay.get(days[i - 1])!;
      const cur = lastByDay.get(days[i])!;
      out.push({
        day: days[i],
        delta: cur.kg - prev.kg,
        close: cur.kg,
      });
    }
    return out;
  }, [readings, scaleId]);

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
        Eintrag pro Tag (Δ zum Vortag)
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
