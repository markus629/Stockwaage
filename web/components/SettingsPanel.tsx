"use client";

import {
  ALLOWED_I2C_PINS,
  ALLOWED_RAIN_PINS,
  ALLOWED_SCK_PINS,
  ALLOWED_WAKE_PINS,
  BME280_ADDRS,
  DEFAULT_BME280_ADDR,
  DEFAULT_HX711_SCK,
  DEFAULT_I2C_SCL,
  DEFAULT_I2C_SDA,
  DEFAULT_INA_BATTERY_ADDR,
  DEFAULT_INA_SOLAR_ADDR,
  DEFAULT_RAIN_PIN,
  DEFAULT_WAKE_PIN,
  INA219_ADDRS,
  SCALE_SLOTS,
  computePinOwners,
  updateGlobalConfig,
  type MainConfig,
} from "@/lib/devices";
import { FEED_STEP_THRESHOLD_KG } from "@/lib/analysis";
import DebouncedInput from "./DebouncedInput";
import PinSelect from "./PinSelect";

// GLOBALE Einstellungen – gelten fuer ALLE ESPs (ein Dokument). Kalibrierung
// und die Anzahl der Waagen sind davon ausgenommen (pro Geraet, siehe Kachel).
// Die Hardware-/Sensor-Sektionen betreffen nur den S3-Bienenstand; die C5-
// Firmware ignoriert sie (feste Hardware).
type Props = {
  mainCfg: MainConfig;
};

export default function SettingsPanel({ mainCfg }: Props) {
  const set = (patch: Partial<MainConfig>) => updateGlobalConfig(patch);
  // Pin-Kollisionen anhand der Standard-DT-Pin-Belegung aller Slots (alle S3
  // gleich aufgebaut) plus der globalen Hardware-Pins.
  const pinOwners = computePinOwners({}, [...SCALE_SLOTS], mainCfg);
  const i2cSda = mainCfg.i2cSda ?? DEFAULT_I2C_SDA;
  const i2cScl = mainCfg.i2cScl ?? DEFAULT_I2C_SCL;

  return (
    <div className="space-y-4">
      <Section
        title="Allgemein"
        subtitle="Diese Werte gelten für alle ESPs gleichzeitig."
      >
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={mainCfg.deepSleepEnabled ?? true}
            onChange={(e) => set({ deepSleepEnabled: e.target.checked })}
            className="mt-1"
          />
          <span className="text-sm">
            Deep Sleep (Akku-Sparmodus)
            <span className="mt-0.5 block text-xs text-neutral-500">
              An: Die ESPs schlafen zwischen den Messungen – stromsparend, aber
              Einstellungen/Updates greifen erst beim nächsten Aufwachen. Aus:
              Sie bleiben wach und übernehmen Änderungen sofort (höherer
              Verbrauch). Gemessen wird in beiden Fällen im Intervall.
            </span>
          </span>
        </label>

        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={mainCfg.autoUpdateEnabled ?? false}
            onChange={(e) => set({ autoUpdateEnabled: e.target.checked })}
            className="mt-1"
          />
          <span className="text-sm">
            Firmware automatisch installieren
            <span className="mt-0.5 block text-xs text-neutral-500">
              Jeder ESP zieht neue Releases beim Aufwachen selbst. (Manuell geht
              es jederzeit über die Firmware-Liste auf der Startseite.)
            </span>
          </span>
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Mess-Intervall (Sekunden)">
            <DebouncedInput
              type="number"
              min={30}
              step={30}
              value={mainCfg.intervalSec ?? 900}
              onCommit={(raw) => {
                const v = parseInt(raw, 10);
                if (!isNaN(v) && v >= 30) set({ intervalSec: v });
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            />
            <Hint>
              {(mainCfg.deepSleepEnabled ?? true)
                ? "Wirkt ab nächstem ESP-Wakeup."
                : "Wirkt sofort (Deep Sleep ist aus)."}
            </Hint>
          </Field>
        </div>
      </Section>

      <Section
        title="Futter-Tracker"
        subtitle="Für die Futter-Reichweite: wie groß darf eine Tagesänderung sein, damit sie noch als Verbrauch zählt? Größere Sprünge (Füttern, Durchsicht) werden ignoriert."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sprung-Schwelle (kg/Tag)">
            <DebouncedInput
              type="number"
              min={0.1}
              step={0.1}
              value={mainCfg.feedStepThresholdKg ?? FEED_STEP_THRESHOLD_KG}
              onCommit={(raw) => {
                const v = parseFloat(raw.replace(",", "."));
                if (!isNaN(v) && v > 0) set({ feedStepThresholdKg: v });
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            />
            <Hint>
              Standard 1,0 kg/Tag. Tagesänderungen darüber zählen nicht zum
              Verbrauch.
            </Hint>
          </Field>
        </div>
      </Section>

      <div className="pt-2">
        <h2 className="text-sm font-semibold text-neutral-700">
          S3-Bienenstand · Hardware
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Gilt für alle S3 (alle gleich aufgebaut). Die DT-Pins der einzelnen
          Waagen stellst du pro Gerät im Bienenstand-Fenster ein. Die C5
          ignoriert diese Einstellungen.
        </p>
      </div>

      <Section
        title="Waagen-Bus (HX711)"
        subtitle="Alle Wägezellen teilen sich einen gemeinsamen Clock-Pin (SCK)."
      >
        <Field label="SCK-Pin (GPIO, gemeinsam)">
          <PinSelect
            value={mainCfg.sckPin ?? DEFAULT_HX711_SCK}
            allowed={ALLOWED_SCK_PINS}
            onChange={(v) => set({ sckPin: v })}
            pinOwners={pinOwners}
            ownerKey="HX711 SCK"
            defaultMarker={DEFAULT_HX711_SCK}
          />
          <Hint>
            Standard GPIO 4. Für minimalen Stromverbrauch einen{" "}
            <strong>RTC-fähigen Pin (GPIO ≤ 21)</strong> wählen – nur dann hält
            der ESP den HX711 im Deep Sleep im Stromspar-Modus.
          </Hint>
        </Field>
      </Section>

      <Section
        title="I2C-Bus"
        subtitle="SDA + SCL für BMP280 und INA219 (Akku/Solar) – alle teilen sich den Bus."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SDA (GPIO)">
            <PinSelect
              value={i2cSda}
              allowed={ALLOWED_I2C_PINS}
              onChange={(v) => set({ i2cSda: v })}
              pinOwners={pinOwners}
              ownerKey="I2C SDA"
            />
          </Field>
          <Field label="SCL (GPIO)">
            <PinSelect
              value={i2cScl}
              allowed={ALLOWED_I2C_PINS}
              onChange={(v) => set({ i2cScl: v })}
              pinOwners={pinOwners}
              ownerKey="I2C SCL"
            />
          </Field>
        </div>
      </Section>

      <SensorSection
        title="Temperatursensor (BMP280)"
        subtitle="Temperatur für die Gewichts-Kompensation (Luftdruck nebenbei)."
        enabled={mainCfg.bme280Enabled ?? false}
        onEnabledChange={(v) => set({ bme280Enabled: v })}
      >
        <Field label="I2C-Adresse">
          <AddrSelect
            value={mainCfg.bme280Addr ?? DEFAULT_BME280_ADDR}
            allowed={BME280_ADDRS}
            onChange={(v) => set({ bme280Addr: v })}
          />
          <Hint>Standard 0x76; 0x77 wenn SDO am Modul auf VCC liegt.</Hint>
        </Field>
      </SensorSection>

      <SensorSection
        title="INA219 — Akku"
        subtitle="Misst Akku-Spannung und Lade-/Entladestrom."
        enabled={mainCfg.inaBatteryEnabled ?? false}
        onEnabledChange={(v) => set({ inaBatteryEnabled: v })}
      >
        <Field label="I2C-Adresse">
          <AddrSelect
            value={mainCfg.inaBatteryAddr ?? DEFAULT_INA_BATTERY_ADDR}
            allowed={INA219_ADDRS}
            onChange={(v) => set({ inaBatteryAddr: v })}
            busy={
              mainCfg.inaSolarEnabled
                ? mainCfg.inaSolarAddr ?? DEFAULT_INA_SOLAR_ADDR
                : undefined
            }
          />
          <Hint>Werks-Standard 0x40. Mehrere INA219 am Bus: A0/A1 löten.</Hint>
        </Field>
      </SensorSection>

      <SensorSection
        title="INA219 — Solar"
        subtitle="Misst Solarpanel-Spannung und -Strom (auch Helligkeits-Indikator)."
        enabled={mainCfg.inaSolarEnabled ?? false}
        onEnabledChange={(v) => set({ inaSolarEnabled: v })}
      >
        <Field label="I2C-Adresse">
          <AddrSelect
            value={mainCfg.inaSolarAddr ?? DEFAULT_INA_SOLAR_ADDR}
            allowed={INA219_ADDRS}
            onChange={(v) => set({ inaSolarAddr: v })}
            busy={
              mainCfg.inaBatteryEnabled
                ? mainCfg.inaBatteryAddr ?? DEFAULT_INA_BATTERY_ADDR
                : undefined
            }
          />
          <Hint>Muss sich von der Akku-Adresse unterscheiden (z.B. 0x41).</Hint>
        </Field>
      </SensorSection>

      <SensorSection
        title="Regensensor"
        subtitle="Kapazitiver/resistiver Streifen, analog gemessen."
        enabled={mainCfg.rainEnabled ?? false}
        onEnabledChange={(v) => set({ rainEnabled: v })}
      >
        <Field label="ADC-Pin (input-only)">
          <PinSelect
            value={mainCfg.rainPin ?? DEFAULT_RAIN_PIN}
            allowed={ALLOWED_RAIN_PINS}
            onChange={(v) => set({ rainPin: v })}
            pinOwners={pinOwners}
            ownerKey="Regensensor"
          />
          <Hint>
            ADC1 (GPIO 1–10). Trocken ≈ hoch (~4095), nass ≈ 0. Mit 3,3 V
            versorgen.
          </Hint>
        </Field>
      </SensorSection>

      <SensorSection
        title="Wake-Button"
        subtitle="Externer Taster. 1× = sofort messen, 2× = Messpause."
        enabled={mainCfg.wakeButtonEnabled ?? false}
        onEnabledChange={(v) => set({ wakeButtonEnabled: v })}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GPIO">
            <PinSelect
              value={mainCfg.wakeButtonPin ?? DEFAULT_WAKE_PIN}
              allowed={ALLOWED_WAKE_PINS}
              onChange={(v) => set({ wakeButtonPin: v })}
              pinOwners={pinOwners}
              ownerKey="Wake-Button"
            />
          </Field>
          <Field label="Trigger-Level">
            <select
              value={mainCfg.wakeButtonLevel ?? 0}
              onChange={(e) =>
                set({ wakeButtonLevel: parseInt(e.target.value, 10) })
              }
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value={0}>LOW (Taster nach GND, interner Pull-Up)</option>
              <option value={1}>HIGH (Taster nach 3.3 V, ext. Pull-Down)</option>
            </select>
          </Field>
          <Field label="Messpause bei Doppelklick (Minuten)">
            <DebouncedInput
              type="number"
              min={1}
              max={1440}
              value={mainCfg.wakePauseMin ?? 30}
              onCommit={(raw) => {
                const v = parseInt(raw, 10);
                if (!isNaN(v) && v >= 1) set({ wakePauseMin: Math.min(1440, v) });
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </Field>
        </div>
      </SensorSection>
    </div>
  );
}

function hex(n: number | undefined): string {
  if (n === undefined) return "—";
  return "0x" + n.toString(16).toUpperCase().padStart(2, "0");
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
  children,
}: {
  title: string;
  subtitle?: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
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
          <span className="text-sm font-semibold">{title}</span>
          {subtitle && (
            <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
          )}
        </div>
      </label>
      {enabled && (
        <div className="mt-3 border-t border-neutral-200 pt-3">{children}</div>
      )}
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
