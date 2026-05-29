"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Comment, DailyStat } from "@/lib/devices";

type Props = {
  scaleId: string;
  stats: DailyStat[];
  comments: Comment[];
};

type RangeOption = { label: string; days: number | "all" };
const RANGES: RangeOption[] = [
  { label: "3 T", days: 3 },
  { label: "1 W", days: 7 },
  { label: "2 W", days: 14 },
  { label: "3 W", days: 21 },
  { label: "1 M", days: 30 },
  { label: "2 M", days: 60 },
  { label: "3 M", days: 90 },
  { label: "6 M", days: 180 },
  { label: "1 J", days: 365 },
  { label: "Alle", days: "all" },
];
const DEFAULT_RANGE_IDX = 4; // 1 M

const TARGET_POINTS = 120;

type ChartPoint = {
  ts: number;
  avg: number;
  range: [number, number];
  label: string;
  days: number;
  comments?: Comment[];
  commentY?: number;
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

function buildBuckets(
  stats: DailyStat[],
  scaleId: string,
  rangeDays: number | "all",
  comments: Comment[],
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

  const scaleComments = comments
    .filter((c) => c.scaleId === scaleId)
    .sort((a, b) => a.ts - b.ts);
  for (const c of scaleComments) {
    let target: ChartPoint | null = null;
    for (const b of out) {
      if (b.ts <= c.ts) target = b;
      else break;
    }
    if (!target) target = out[0];
    if (!target) continue;
    (target.comments ??= []).push(c);
    target.commentY = target.avg;
  }
  return out;
}

export default function ScaleLongTermChart({
  scaleId,
  stats,
  comments,
}: Props) {
  const [rangeIdx, setRangeIdx] = useState<number>(DEFAULT_RANGE_IDX);
  const [popup, setPopup] = useState<{ label: string; items: Comment[] } | null>(
    null,
  );
  const range = RANGES[rangeIdx].days;

  const data = useMemo(
    () => buildBuckets(stats, scaleId, range, comments),
    [stats, scaleId, range, comments],
  );
  const bucketDays = data.length > 0 ? data[0].days : 1;

  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">
          Langzeit (Ø/Tag, Min–Max)
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label="kürzerer Zeitraum"
            disabled={rangeIdx <= 0}
            onClick={() => setRangeIdx((i) => i - 1)}
            className="rounded border border-neutral-300 px-1.5 leading-none text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
          >
            ‹
          </button>
          <span className="min-w-[3rem] text-center text-xs font-medium tabular-nums">
            {RANGES[rangeIdx].label}
          </span>
          <button
            type="button"
            aria-label="längerer Zeitraum"
            disabled={rangeIdx >= RANGES.length - 1}
            onClick={() => setRangeIdx((i) => i + 1)}
            className="rounded border border-neutral-300 px-1.5 leading-none text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"
          >
            ›
          </button>
        </div>
        {bucketDays > 1 && (
          <span className="w-full text-[10px] text-neutral-400">
            ø je {bucketDays} Tage zusammengefasst
          </span>
        )}
      </div>

      {data.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded border border-dashed border-neutral-200 text-xs text-neutral-400">
          Noch keine Tages-Daten – füllt sich ab dem ersten vollen Tag.
        </div>
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer>
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) =>
                  fmtDate(new Date(v).toISOString().slice(0, 10))
                }
              />
              <YAxis
                tick={{ fontSize: 10 }}
                width={42}
                domain={["auto", "auto"]}
                tickFormatter={(v) => `${(v as number).toFixed(1)}`}
              />
              <Tooltip
                labelFormatter={(v) =>
                  fmtDate(new Date(Number(v)).toISOString().slice(0, 10))
                }
                formatter={(value, name) => {
                  if (name === "range") {
                    const r = value as unknown as [number, number];
                    return [
                      `${r[0].toFixed(2)} – ${r[1].toFixed(2)} kg`,
                      "Min/Max",
                    ];
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
              <Scatter
                dataKey="commentY"
                shape={<CommentDot />}
                isAnimationActive={false}
                onClick={(p: { payload?: ChartPoint }) => {
                  const items = p?.payload?.comments;
                  if (items?.length) {
                    setPopup({ label: p.payload!.label, items });
                  }
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {popup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setPopup(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Logbuch · {popup.label}</h4>
              <button
                type="button"
                onClick={() => setPopup(null)}
                className="text-neutral-500 hover:text-neutral-900"
              >
                ✕
              </button>
            </div>
            <ul className="space-y-1.5 text-sm">
              {[...popup.items]
                .sort((a, b) => b.ts - a.ts)
                .map((c) => (
                  <li
                    key={c.id}
                    className="border-b border-neutral-100 pb-1.5 last:border-0"
                  >
                    <span className="block font-mono text-xs text-neutral-500">
                      {new Date(c.ts).toLocaleString("de-DE", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {c.text}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload?.comments?.length) return null;
  const n = payload.comments.length;
  return (
    <g style={{ cursor: "pointer" }}>
      <circle cx={cx} cy={cy} r={7} fill="#f59e0b" stroke="#fff" strokeWidth={2} />
      {n > 1 && (
        <text
          x={cx}
          y={cy + 3}
          textAnchor="middle"
          fontSize={9}
          fontWeight="bold"
          fill="#fff"
        >
          {n}
        </text>
      )}
    </g>
  );
}
