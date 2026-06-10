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
        title="Verhalten"
        scope="all"
        subtitle="Mess- und Update-Verhalten – gilt für jeden ESP (S3 wie C5). Die ESPs schlafen zwischen den Messungen (Akku-Sparmodus). Zum Testen/Kalibrieren hältst du einzelne Geräte gezielt im Geräte-Fenster wach („Wach halten“)."
      >
        {mainCfg.deepSleepEnabled === false && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
            <span>
              <strong>Dauer-Wach-Modus aktiv</strong> (alte globale
              Einstellung): alle ESPs bleiben wach und verbrauchen mehr Akku.
            </span>
            <button
              type="button"
              onClick={() => set({ deepSleepEnabled: true })}
              className="shrink-0 rounded bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700"
            >
              Schlafmodus aktivieren
            </button>
          </div>
        )}

        <label className="flex items-start gap-2">
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
              Wirkt ab dem nächsten Aufwachen des ESP (bzw. sofort, solange ein
              Gerät im Testmodus wach gehalten wird).
            </Hint>
          </Field>
        </div>
      </Section>

      <Section
        title="Auswertung & Alarme"
        scope="dashboard"
        subtitle="Rein clientseitige Auswertung im Dashboard – am Gerät ändert sich nichts. Futter-Reichweite: wie groß darf eine Tagesänderung sein, damit sie noch als Verbrauch zählt? Größere Sprünge (Füttern, Durchsicht) werden ignoriert."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Futter-Sprung-Schwelle (kg/Tag)">
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

      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-amber-900">
            🐝 Bienenstand-Hardware
          </h2>
          <ScopeBadge scope="s3" />
        </div>
        <p className="mt-1 text-xs text-amber-800/90">
          Alle S3 sind baugleich – Sensoren und Bus-Pins gelten daher gemeinsam.
          <strong>
            {" "}
            Anzahl der Waagen und der DT-Pin je Waage sind dagegen pro Stand
            individuell
          </strong>{" "}
          (5 Völker hier, 7 dort) – das stellst du im jeweiligen
          Bienenstand-Fenster über <em>+ Waage</em> / <em>− Waage</em> ein. Die
          C5 ignoriert diese Einstellungen (feste Hardware).
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

// Reichweiten-Badge: macht je Abschnitt sofort klar, WORAUF eine Einstellung
// wirkt – das ist der Schluessel zur Nachvollziehbarkeit.
type ScopeKind = "all" | "dashboard" | "s3";

function ScopeBadge({ scope }: { scope: ScopeKind }) {
  const map: Record<ScopeKind, { label: string; cls: string }> = {
    all: {
      label: "Alle Geräte",
      cls: "bg-stone-200 text-stone-600",
    },
    dashboard: {
      label: "Nur Dashboard",
      cls: "bg-sky-100 text-sky-700",
    },
    s3: {
      label: "Alle Bienenstände (S3)",
      cls: "bg-amber-100 text-amber-700",
    },
  };
  const { label, cls } = map[scope];
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function Section({
  title,
  subtitle,
  scope,
  children,
}: {
  title: string;
  subtitle?: string;
  scope?: ScopeKind;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {scope && <ScopeBadge scope={scope} />}
      </div>
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
