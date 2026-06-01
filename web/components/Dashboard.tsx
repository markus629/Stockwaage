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
import {
  DEFAULT_SWARM_DROP_KG,
  DEFAULT_SWARM_WINDOW_MIN,
  type DailyStat,
  type MainConfig,
  type Reading,
  type ScaleConfig,
} from "@/lib/devices";
import ScaleChart from "./ScaleChart";
import { ScaleFeedStatus, ScaleSwarmStatus } from "./HiveStatus";
import LiveWeight from "./LiveWeight";

const DASHBOARD_DAYS = 3;

type Props = {
  readings: Reading[];
  latest: Reading | null;
  scales: Record<string, ScaleConfig>;
  scaleIds: string[];
  mainCfg: MainConfig;
  dailyStats: DailyStat[];
  onScaleClick?: (scaleId: string) => void;
};

export default function Dashboard({
  readings,
  latest,
  scales,
  scaleIds,
  mainCfg,
  dailyStats,
  onScaleClick,
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

  const hasScales = dashboardScales.length > 0;
  const empty =
    !hasScales && !showTemp && !showBattery && !showSolar && !showRain;

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
      {/* Pro Waage eine Kachel: Graph + Schwarm-Alarm + Futter-Reichweite.
          Nur fuer mit Stern markierte Waagen (onDashboard). */}
      {dashboardScales.map((sid) => (
        <Tile
          key={sid}
          title={scales[sid]?.name || sid}
          subtitle={sid}
          onClick={onScaleClick ? () => onScaleClick(sid) : undefined}
        >
          <ScaleChart scaleId={sid} readings={windowReadings} days={DASHBOARD_DAYS} />
          <div className="mt-2 space-y-1 border-t border-neutral-100 pt-2">
            <LiveWeight reading={latest?.scales?.[sid]} />
            <ScaleSwarmStatus
              readings={windowReadings}
              scaleId={sid}
              dropKg={mainCfg.swarmDropKg ?? DEFAULT_SWARM_DROP_KG}
              windowMin={mainCfg.swarmWindowMin ?? DEFAULT_SWARM_WINDOW_MIN}
            />
            <ScaleFeedStatus dailyStats={dailyStats} scaleId={sid} />
          </div>
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
        <Tile title="Regen" subtitle={`${DASHBOARD_DAYS} Tage`}>
          <RainBars readings={windowReadings} />
        </Tile>
      )}
    </div>
  );
}

function Tile({
  title,
  subtitle,
  onClick,
  children,
}: {
  title: string;
  subtitle?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const clickable = !!onClick;
  return (
    <section
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? "Zur Waage" : undefined}
      className={`rounded-lg border border-neutral-200 bg-white p-3 ${
        clickable
          ? "cursor-pointer transition hover:border-neutral-400 hover:bg-neutral-50"
          : ""
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
