"use client";

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, orderBy, query } from "firebase/firestore";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  dailyStatsCol,
  type DailyStat,
  type ScaleConfig,
} from "@/lib/devices";

type Props = {
  deviceId: string;
  scales: Record<string, ScaleConfig>;
  scaleIds: string[];
};

type RangeOption = { label: string; days: number | "all" };
const RANGES: RangeOption[] = [
  { label: "7 T", days: 7 },
  { label: "30 T", days: 30 },
  { label: "90 T", days: 90 },
  { label: "1 J", days: 365 },
  { label: "Alle", days: "all" },
];

const TARGET_POINTS = 120;

type ChartPoint = {
  ts: number;
  avg: number;
  range: [number, number];
  label: string;
  days: number;
};

function buildBuckets(
  stats: DailyStat[],
  scaleId: string,
  rangeDays: number | "all",
): ChartPoint[] {
  let rows = stats
    .map((s) => ({ date: s.date, agg: s.scales?.[scaleId] }))
    .filter(
      (r): r is { date: string; agg: NonNullable<typeof r.agg> } =>
        !!r.agg && r.agg.count > 0 && isFinite(r.agg.sum),
    );
  if (rangeDays !== "all") {
    const cutoff = Date.now() - rangeDays * 86_400_000;
    rows = rows.filter((r) => new Date(r.date).getTime() >= cutoff);
  }
  if (rows.length === 0) return [];

  const bucketDays = Math.max(1, Math.ceil(rows.length / TARGET_POINTS));
  const out: ChartPoint[] = [];
  for (let i = 0; i < rows.length; i += bucketDays) {
    const slice = rows.slice(i, i + bucketDays);
    let sumSum = 0;
    let sumCount = 0;
    let mn = Infinity;
    let mx = -Infinity;
    for (const d of slice) {
      sumSum += d.agg.sum;
      sumCount += d.agg.count;
      if (d.agg.min < mn) mn = d.agg.min;
      if (d.agg.max > mx) mx = d.agg.max;
    }
    const first = slice[0].date;
    const last = slice[slice.length - 1].date;
    out.push({
      ts: new Date(first).getTime(),
      avg: sumCount > 0 ? sumSum / sumCount : 0,
      range: [mn, mx],
      label: bucketDays === 1 ? fmtDate(first) : `${fmtDate(first)}–${fmtDate(last)}`,
      days: slice.length,
    });
  }
  return out;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

export default function LongTermView({ deviceId, scales, scaleIds }: Props) {
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<number | "all">(90);
  const [scaleId, setScaleId] = useState<string>("");

  useEffect(() => {
    if (!deviceId) return;
    const q = query(dailyStatsCol(deviceId), orderBy("date", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setStats(snap.docs.map((d) => d.data() as DailyStat));
      setLoading(false);
    });
    return () => unsub();
  }, [deviceId]);

  // Default-Waage: erste verfügbare.
  const effectiveScale = scaleId || scaleIds[0] || "";

  const data = useMemo(
    () => buildBuckets(stats, effectiveScale, range),
    [stats, effectiveScale, range],
  );

  const bucketDays = data.length > 0 ? data[0].days : 1;

  if (scaleIds.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
        Noch keine Waage konfiguriert.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <select
          value={effectiveScale}
          onChange={(e) => setScaleId(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          {scaleIds.map((sid) => (
            <option key={sid} value={sid}>
              {scales[sid]?.name || sid}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={() => setRange(r.days)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                range === r.days
                  ? "bg-neutral-900 text-white"
                  : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {bucketDays > 1 && (
          <span className="text-xs text-neutral-500">
            ø je {bucketDays} Tage zusammengefasst
          </span>
        )}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        {loading ? (
          <p className="py-12 text-center text-sm text-neutral-400">Laden…</p>
        ) : data.length === 0 ? (
          <p className="py-12 text-center text-sm text-neutral-400">
            Noch keine Tages-Daten für diesen Zeitraum. Der ESP legt pro Tag
            automatisch ein Aggregat an – die Kurve füllt sich mit der Zeit.
          </p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <ComposedChart
                data={data}
                margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => fmtDate(new Date(v).toISOString().slice(0, 10))}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={48}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => `${(v as number).toFixed(1)}`}
                  label={{
                    value: "kg",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 10, fill: "#888" },
                  }}
                />
                <Tooltip
                  labelFormatter={(v) =>
                    fmtDate(new Date(Number(v)).toISOString().slice(0, 10))
                  }
                  formatter={(value, name) => {
                    if (name === "range") {
                      const r = value as unknown as [number, number];
                      return [`${r[0].toFixed(2)} – ${r[1].toFixed(2)} kg`, "Min/Max"];
                    }
                    return [`${Number(value).toFixed(2)} kg`, "Ø"];
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area
                  dataKey="range"
                  stroke="none"
                  fill="#3b82f6"
                  fillOpacity={0.12}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="avg"
                  stroke="#1d4ed8"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
