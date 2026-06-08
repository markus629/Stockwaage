"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  DailyStat,
  Device,
  MainConfig,
  Reading,
  ScaleConfig,
} from "@/lib/devices";
import ScaleChart from "./ScaleChart";

const DASHBOARD_DAYS = 3;
// Fenster fuer die Winterfutter-Hochrechnung (Tage Durchschnitts-Verbrauch).
const FEED_TREND_DAYS = 21;

type Props = {
  readings: Reading[];
  scales: Record<string, ScaleConfig>;
  scaleIds: string[];
  mainCfg: MainConfig;
  device: Device | null;
  dailyStats: DailyStat[];
};

export default function Dashboard({
  readings,
  scales,
  scaleIds,
  mainCfg,
  device,
  dailyStats,
}: Props) {
  const windowReadings = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const cutoff = start.getTime() - (DASHBOARD_DAYS - 1) * 24 * 3600 * 1000;
    return readings.filter((r) => r.ts >= cutoff);
  }, [readings]);

  const dashboardScales = scaleIds.filter((sid) => scales[sid]?.onDashboard);

  const showTemp =
    !!mainCfg.bme280Enabled &&
    windowReadings.some((r) => r.ambientC !== undefined);
  const showBattery =
    !!mainCfg.inaBatteryEnabled &&
    windowReadings.some((r) => r.batteryV !== undefined);
  const showSolar =
    !!mainCfg.inaSolarEnabled &&
    windowReadings.some((r) => r.solarV !== undefined);
  const showRain =
    !!mainCfg.rainEnabled &&
    windowReadings.some((r) => r.rainRaw !== undefined);

  // Status je Waage: Schwarm-Flag + Futter-Trend (kg/Tag, Reichweite).
  const statusRows = useMemo(
    () =>
      scaleIds.map((sid) => ({
        sid,
        name: scales[sid]?.name || sid,
        swarm: !!device?.swarmAlerts?.[sid],
        feed: feedTrend(dailyStats, sid),
      })),
    [scaleIds, scales, device, dailyStats],
  );
  const hasStatus = scaleIds.length > 0;

  const empty =
    !hasStatus &&
    dashboardScales.length === 0 &&
    !showTemp &&
    !showBattery &&
    !showSolar &&
    !showRain;

  if (empty) {
    return (
      <div className="rounded border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
        Noch keine Kacheln. Im Tab „Waagen“ pro Waage das Stern-Symbol
        aktivieren, oder in den „Einstellungen“ einen Sensor aktivieren.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {hasStatus && (
        <Tile title="Status" subtitle="Schwarm & Futter" wide>
          <ul className="divide-y divide-neutral-100 text-sm">
            {statusRows.map((r) => (
              <li
                key={r.sid}
                className="flex items-center gap-2 py-1.5"
              >
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                    r.swarm ? "bg-red-500" : "bg-green-500"
                  }`}
                  title={r.swarm ? "Schwarm-Verdacht!" : "alles ok"}
                />
                <span className="flex-1 truncate">{r.name}</span>
                {r.swarm && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                    Schwarm?
                  </span>
                )}
                <span className="font-mono text-xs text-neutral-500">
                  {r.feed
                    ? `${r.feed.perDay > 0 ? "+" : ""}${r.feed.perDay.toFixed(
                        2,
                      )} kg/Tag${
                        r.feed.daysLeft !== null
                          ? ` · ~${r.feed.daysLeft} T`
                          : ""
                      }`
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-neutral-400">
            kg/Tag = Ø-Änderung der letzten {FEED_TREND_DAYS} Tage. Bei
            Abnahme: geschätzte Reichweite bis 0 kg (Winterfutter).
          </p>
        </Tile>
      )}

      {dashboardScales.map((sid) => (
        <Tile
          key={sid}
          title={scales[sid]?.name || sid}
          subtitle={sid}
        >
          <ScaleChart scaleId={sid} readings={windowReadings} days={3} />
        </Tile>
      ))}

      {showTemp && (
        <Tile
          title="Außenklima"
          subtitle={`${DASHBOARD_DAYS} Tage`}
        >
          <DualLineChart
            readings={windowReadings}
            series={[
              {
                key: "ambientC",
                label: "°C",
                color: "#dc2626",
                axis: "left",
              },
              {
                key: "ambientHumidity",
                label: "% rF",
                color: "#2563eb",
                axis: "right",
              },
            ]}
          />
        </Tile>
      )}

      {showBattery && (
        <Tile title="Akku" subtitle={`${DASHBOARD_DAYS} Tage`}>
          <DualLineChart
            readings={windowReadings}
            series={[
              {
                key: "batteryV",
                label: "V",
                color: "#16a34a",
                axis: "left",
              },
              {
                key: "batteryA",
                label: "mA",
                color: "#a16207",
                axis: "right",
                transform: (v) => v * 1000,
              },
            ]}
          />
        </Tile>
      )}

      {showSolar && (
        <Tile title="Solar" subtitle={`${DASHBOARD_DAYS} Tage`}>
          <DualLineChart
            readings={windowReadings}
            series={[
              {
                key: "solarV",
                label: "V",
                color: "#f59e0b",
                axis: "left",
              },
              {
                key: "solarA",
                label: "mA",
                color: "#a16207",
                axis: "right",
                transform: (v) => v * 1000,
              },
            ]}
          />
        </Tile>
      )}

      {showRain && (
        <Tile
          title="Regen"
          subtitle={`${DASHBOARD_DAYS} Tage`}
          wide
        >
          <RainBars readings={windowReadings} />
        </Tile>
      )}
    </div>
  );
}

function Tile({
  title,
  subtitle,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-lg border border-neutral-200 bg-white p-3 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && (
          <span className="text-xs text-neutral-400">{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}

type SeriesDef = {
  key: keyof Reading;
  label: string;
  color: string;
  axis: "left" | "right";
  transform?: (v: number) => number;
};

function DualLineChart({
  readings,
  series,
}: {
  readings: Reading[];
  series: SeriesDef[];
}) {
  const data = useMemo(() => {
    return readings
      .map((r) => {
        const row: Record<string, number> = { ts: r.ts };
        for (const s of series) {
          const v = r[s.key];
          if (typeof v === "number" && isFinite(v)) {
            row[s.key as string] = s.transform ? s.transform(v) : v;
          }
        }
        return row;
      })
      .sort((a, b) => a.ts - b.ts);
  }, [readings, series]);

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-neutral-400">
        Keine Daten
      </div>
    );
  }

  const hasRight = series.some((s) => s.axis === "right");

  return (
    <div className="h-32 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 10 }}
            tickFormatter={tsLabel}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10 }}
            width={36}
            tickFormatter={(v) => `${(v as number).toFixed(1)}`}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10 }}
              width={36}
              tickFormatter={(v) => `${(v as number).toFixed(0)}`}
            />
          )}
          <Tooltip
            labelFormatter={(v) =>
              new Date(Number(v)).toLocaleString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            }
            formatter={(value, name) => {
              const s = series.find((s) => s.key === name);
              return [`${Number(value).toFixed(2)} ${s?.label ?? ""}`, ""];
            }}
            contentStyle={{ fontSize: 12 }}
          />
          {series.map((s) => (
            <Line
              key={String(s.key)}
              yAxisId={s.axis}
              type="monotone"
              dataKey={s.key as string}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-neutral-500">
        {series.map((s) => (
          <span key={String(s.key)} className="flex items-center gap-1">
            <span
              className="inline-block h-0.5 w-3"
              style={{ background: s.color }}
            />
            {String(s.key)} ({s.label})
          </span>
        ))}
      </div>
    </div>
  );
}

function RainBars({ readings }: { readings: Reading[] }) {
  const data = useMemo(
    () =>
      readings
        .filter((r) => r.rainRaw !== undefined)
        .map((r) => ({ ts: r.ts, rainRaw: r.rainRaw as number }))
        .sort((a, b) => a.ts - b.ts),
    [readings],
  );
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-neutral-400">
        Keine Daten
      </div>
    );
  }
  return (
    <div className="h-32 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 10 }}
            tickFormatter={tsLabel}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            width={42}
            domain={[0, 4095]}
          />
          <Tooltip
            labelFormatter={(v) =>
              new Date(Number(v)).toLocaleString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            }
            formatter={(value) => [`${value}`, "Rohwert"]}
            contentStyle={{ fontSize: 12 }}
          />
          <Bar
            dataKey="rainRaw"
            fill="#1d4ed8"
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function tsLabel(v: number | string): string {
  const d = new Date(Number(v));
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}h`;
}

// Lineare Regression ueber die Tages-Schlussgewichte (last) der letzten
// FEED_TREND_DAYS Tage -> Steigung in kg/Tag. Bei Abnahme zusaetzlich die
// geschaetzte Reichweite bis 0 kg (Winterfutter-Prognose).
function feedTrend(
  stats: DailyStat[],
  scaleId: string,
): { perDay: number; daysLeft: number | null } | null {
  const cutoff = Date.now() - FEED_TREND_DAYS * 86_400_000;
  const pts: Array<{ x: number; y: number }> = [];
  for (const s of stats) {
    const agg = s.scales?.[scaleId];
    if (!agg || agg.count <= 0 || !isFinite(agg.last)) continue;
    const t = new Date(s.date).getTime();
    if (t < cutoff) continue;
    pts.push({ x: t / 86_400_000, y: agg.last }); // x in Tagen
  }
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  if (den === 0) return null;
  const perDay = num / den;
  const lastKg = pts[pts.length - 1].y;
  const daysLeft =
    perDay < -0.01 && lastKg > 0
      ? Math.max(0, Math.round(lastKg / -perDay))
      : null;
  return { perDay, daysLeft };
}
