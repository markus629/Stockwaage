"use client";

import {
  ALLOWED_I2C_PINS,
  ALLOWED_RAIN_PINS,
  BME280_ADDRS,
  DEFAULT_BME280_ADDR,
  DEFAULT_INA_BATTERY_ADDR,
  DEFAULT_INA_SOLAR_ADDR,
  DEFAULT_I2C_SCL,
  DEFAULT_I2C_SDA,
  DEFAULT_RAIN_PIN,
  INA219_ADDRS,
  updateMainConfig,
  type MainConfig,
  type Reading,
} from "@/lib/devices";
import PinSelect from "./PinSelect";

const DAYS_MIN = 1;
const DAYS_MAX = 30;

type Props = {
  deviceId: string;
  mainCfg: MainConfig;
  latest: Reading | null;
  intervalSecFallback?: number;
  days: number;
  onDaysChange: (n: number) => void;
  pinOwners: Record<number, string>;
};

function hex(n: number | undefined): string {
  if (n === undefined) return "—";
  return "0x" + n.toString(16).toUpperCase().padStart(2, "0");
}

export default function SettingsPanel({
  deviceId,
  mainCfg,
  latest,
  intervalSecFallback,
  days,
  onDaysChange,
  pinOwners,
}: Props) {
  const i2cSda = mainCfg.i2cSda ?? DEFAULT_I2C_SDA;
  const i2cScl = mainCfg.i2cScl ?? DEFAULT_I2C_SCL;

  return (
    <div className="space-y-4">
      <Section title="Allgemein">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mess-Intervall (Sekunden)">
            <input
              type="number"
              min={30}
              step={30}
              value={mainCfg.intervalSec ?? intervalSecFallback ?? ""}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 30)
                  updateMainConfig(deviceId, { intervalSec: v });
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            />
            <Hint>Wirkt ab nächstem ESP-Wakeup.</Hint>
          </Field>
          <Field label={`Verlauf: Anzahl Tage (${DAYS_MIN}–${DAYS_MAX})`}>
            <input
              type="number"
              min={DAYS_MIN}
              max={DAYS_MAX}
              value={days}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v))
                  onDaysChange(Math.max(DAYS_MIN, Math.min(DAYS_MAX, v)));
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            />
            <Hint>Heute = rot/dick, älteste = blau/dünn.</Hint>
          </Field>
        </div>
      </Section>

      <Section
        title="I2C-Bus"
        subtitle="SDA + SCL für BME280, INA219 (Akku) und INA219 (Solar) – alle teilen sich den Bus."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SDA (GPIO)">
            <PinSelect
              value={i2cSda}
              allowed={ALLOWED_I2C_PINS}
              onChange={(v) => updateMainConfig(deviceId, { i2cSda: v })}
              pinOwners={pinOwners}
              ownerKey="I2C SDA"
            />
          </Field>
          <Field label="SCL (GPIO)">
            <PinSelect
              value={i2cScl}
              allowed={ALLOWED_I2C_PINS}
              onChange={(v) => updateMainConfig(deviceId, { i2cScl: v })}
              pinOwners={pinOwners}
              ownerKey="I2C SCL"
            />
          </Field>
        </div>
      </Section>

      <SensorSection
        title="BME280"
        subtitle="Temperatur, Luftfeuchte, Luftdruck. Ersetzt AM2302."
        enabled={mainCfg.bme280Enabled ?? false}
        onEnabledChange={(v) =>
          updateMainConfig(deviceId, { bme280Enabled: v })
        }
        statusLines={[
          latest?.ambientC !== undefined
            ? `${latest.ambientC.toFixed(1)} °C`
            : null,
          latest?.ambientHumidity !== undefined
            ? `${latest.ambientHumidity.toFixed(0)} % rF`
            : null,
          latest?.ambientPressure !== undefined
            ? `${latest.ambientPressure.toFixed(0)} hPa`
            : null,
        ]}
      >
        <Field label="I2C-Adresse">
          <AddrSelect
            value={mainCfg.bme280Addr ?? DEFAULT_BME280_ADDR}
            allowed={BME280_ADDRS}
            onChange={(v) => updateMainConfig(deviceId, { bme280Addr: v })}
          />
          <Hint>
            Standard 0x76. Wenn SDO (Pin 5 am Modul) auf VCC gezogen ist:
            0x77.
          </Hint>
        </Field>
      </SensorSection>

      <SensorSection
        title="INA219 — Akku"
        subtitle="Misst Akku-Spannung und Lade-/Entladestrom."
        enabled={mainCfg.inaBatteryEnabled ?? false}
        onEnabledChange={(v) =>
          updateMainConfig(deviceId, { inaBatteryEnabled: v })
        }
        statusLines={[
          latest?.batteryV !== undefined
            ? `${latest.batteryV.toFixed(2)} V`
            : null,
          latest?.batteryA !== undefined
            ? `${(latest.batteryA * 1000).toFixed(0)} mA`
            : null,
        ]}
      >
        <Field label="I2C-Adresse">
          <AddrSelect
            value={mainCfg.inaBatteryAddr ?? DEFAULT_INA_BATTERY_ADDR}
            allowed={INA219_ADDRS}
            onChange={(v) =>
              updateMainConfig(deviceId, { inaBatteryAddr: v })
            }
            busy={mainCfg.inaSolarAddr ?? DEFAULT_INA_SOLAR_ADDR}
          />
          <Hint>
            Werks-Standard 0x40 (A0+A1 unbeschaltet). Für mehrere INA219
            am gleichen Bus jeweils A0/A1 löten:
            0x40, 0x41, 0x44, 0x45.
          </Hint>
        </Field>
      </SensorSection>

      <SensorSection
        title="INA219 — Solar"
        subtitle="Misst Solarpanel-Spannung und Strom. Dient gleichzeitig als Helligkeits-Indikator."
        enabled={mainCfg.inaSolarEnabled ?? false}
        onEnabledChange={(v) =>
          updateMainConfig(deviceId, { inaSolarEnabled: v })
        }
        statusLines={[
          latest?.solarV !== undefined
            ? `${latest.solarV.toFixed(2)} V`
            : null,
          latest?.solarA !== undefined
            ? `${(latest.solarA * 1000).toFixed(0)} mA`
            : null,
        ]}
      >
        <Field label="I2C-Adresse">
          <AddrSelect
            value={mainCfg.inaSolarAddr ?? DEFAULT_INA_SOLAR_ADDR}
            allowed={INA219_ADDRS}
            onChange={(v) =>
              updateMainConfig(deviceId, { inaSolarAddr: v })
            }
            busy={mainCfg.inaBatteryAddr ?? DEFAULT_INA_BATTERY_ADDR}
          />
          <Hint>
            Muss sich von der Akku-Adresse unterscheiden. Empfehlung:
            Akku = 0x40, Solar = 0x41 (A0 auf dem Solar-Modul brücken).
          </Hint>
        </Field>
      </SensorSection>

      <SensorSection
        title="Regensensor"
        subtitle="Kapazitiver oder resistiver Streifen, analog gemessen."
        enabled={mainCfg.rainEnabled ?? false}
        onEnabledChange={(v) =>
          updateMainConfig(deviceId, { rainEnabled: v })
        }
        statusLines={[
          latest?.rainRaw !== undefined
            ? `Rohwert ${latest.rainRaw}`
            : null,
        ]}
      >
        <Field label="ADC-Pin (input-only)">
          <PinSelect
            value={mainCfg.rainPin ?? DEFAULT_RAIN_PIN}
            allowed={ALLOWED_RAIN_PINS}
            onChange={(v) => updateMainConfig(deviceId, { rainPin: v })}
            pinOwners={pinOwners}
            ownerKey="Regensensor"
          />
          <Hint>
            Nur input-only GPIOs der ADC1-Bank (33–39). Werte: trocken ~0,
            durchnässt nahe 4095.
          </Hint>
        </Field>
      </SensorSection>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && (
        <p className="mb-3 mt-0.5 text-xs text-neutral-500">{subtitle}</p>
      )}
      {!subtitle && <div className="mb-3" />}
      {children}
    </section>
  );
}

function SensorSection({
  title,
  subtitle,
  enabled,
  onEnabledChange,
  statusLines,
  children,
}: {
  title: string;
  subtitle?: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  statusLines: Array<string | null>;
  children: React.ReactNode;
}) {
  const status = statusLines.filter((s): s is string => !!s).join(" · ");
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">{title}</span>
            <span className="font-mono text-xs text-neutral-500">
              {status || (enabled ? "wartet auf Daten…" : "deaktiviert")}
            </span>
          </div>
          {subtitle && (
            <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
          )}
        </div>
      </label>
      {enabled && <div className="mt-3 border-t border-neutral-200 pt-3">{children}</div>}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1 block text-xs text-neutral-500">{children}</span>
  );
}

function AddrSelect({
  value,
  allowed,
  onChange,
  busy,
}: {
  value: number;
  allowed: readonly number[];
  onChange: (v: number) => void;
  busy?: number;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
    >
      {allowed.map((a) => (
        <option key={a} value={a} disabled={busy !== undefined && busy === a}>
          {hex(a)}
          {busy === a ? " — anderswo belegt" : ""}
        </option>
      ))}
    </select>
  );
}
