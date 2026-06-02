"use client";

import { useEffect, useState } from "react";
import {
  ALLOWED_I2C_PINS,
  ALLOWED_RAIN_PINS,
  ALLOWED_SCK_PINS,
  ALLOWED_WAKE_PINS,
  DEFAULT_HX711_SCK,
  BME280_ADDRS,
  DEFAULT_BME280_ADDR,
  DEFAULT_SWARM_DROP_KG,
  DEFAULT_SWARM_WINDOW_MIN,
  DEFAULT_INA_BATTERY_ADDR,
  DEFAULT_INA_SOLAR_ADDR,
  DEFAULT_I2C_SCL,
  DEFAULT_I2C_SDA,
  DEFAULT_RAIN_PIN,
  DEFAULT_WAKE_PIN,
  firmwareBinUrl,
  INA219_ADDRS,
  isNewerVersion,
  sendCommand,
  updateMainConfig,
  type Device,
  type MainConfig,
  type Reading,
} from "@/lib/devices";
import DebouncedInput from "./DebouncedInput";
import PinSelect from "./PinSelect";
import StarToggle from "./StarToggle";

type Props = {
  deviceId: string;
  device: Device | null;
  mainCfg: MainConfig;
  latest: Reading | null;
  intervalSecFallback?: number;
  pinOwners: Record<number, string>;
};

function hex(n: number | undefined): string {
  if (n === undefined) return "—";
  return "0x" + n.toString(16).toUpperCase().padStart(2, "0");
}

export default function SettingsPanel({
  deviceId,
  device,
  mainCfg,
  latest,
  intervalSecFallback,
  pinOwners,
}: Props) {
  const i2cSda = mainCfg.i2cSda ?? DEFAULT_I2C_SDA;
  const i2cScl = mainCfg.i2cScl ?? DEFAULT_I2C_SCL;

  return (
    <div className="space-y-4">
      <Section title="Allgemein">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={mainCfg.deepSleepEnabled ?? true}
            onChange={(e) =>
              updateMainConfig(deviceId, {
                deepSleepEnabled: e.target.checked,
              })
            }
            className="mt-1"
          />
          <span className="text-sm">
            Deep Sleep (Akku-Sparmodus)
            <span className="mt-0.5 block text-xs text-neutral-500">
              An: Der ESP schläft zwischen den Messungen – stromsparend, aber
              Einstellungen/Updates greifen erst beim nächsten Aufwachen.
              Aus: Der ESP bleibt wach, übernimmt Einstellungen und Updates
              sofort (höherer Verbrauch). Gemessen wird in beiden Fällen im
              eingestellten Intervall.
            </span>
          </span>
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Mess-Intervall (Sekunden)">
            <DebouncedInput
              type="number"
              min={30}
              step={30}
              value={mainCfg.intervalSec ?? intervalSecFallback ?? ""}
              onCommit={(raw) => {
                const v = parseInt(raw, 10);
                if (!isNaN(v) && v >= 30)
                  updateMainConfig(deviceId, { intervalSec: v });
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
        title="Waagen-Bus (HX711)"
        subtitle="Alle Wägezellen teilen sich einen gemeinsamen Clock-Pin (SCK). Die Daten-Pins (DT) stellst du je Waage im Tab „Waagen“ ein."
      >
        <Field label="SCK-Pin (GPIO, gemeinsam)">
          <PinSelect
            value={mainCfg.sckPin ?? DEFAULT_HX711_SCK}
            allowed={ALLOWED_SCK_PINS}
            onChange={(v) => updateMainConfig(deviceId, { sckPin: v })}
            pinOwners={pinOwners}
            ownerKey="HX711 SCK"
            defaultMarker={DEFAULT_HX711_SCK}
          />
          <Hint>
            Standard GPIO 4. Wirkt beim nächsten ESP-Wakeup (bzw. sofort, wenn
            Deep Sleep aus ist).
          </Hint>
        </Field>
      </Section>

      <Section
        title="Schwarm-Alarm"
        subtitle="Wann gilt ein Gewichtssturz als möglicher Schwarm? Wird im Dashboard ausgewertet (rein clientseitig)."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gewichtssturz (kg)">
            <DebouncedInput
              type="number"
              min={0.1}
              step={0.1}
              value={mainCfg.swarmDropKg ?? DEFAULT_SWARM_DROP_KG}
              onCommit={(raw) => {
                const v = parseFloat(raw.replace(",", "."));
                if (!isNaN(v) && v > 0)
                  updateMainConfig(deviceId, { swarmDropKg: v });
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            />
            <Hint>Standard 1,5 kg. Größerer Wert = weniger Fehlalarme.</Hint>
          </Field>
          <Field label="Zeitfenster (Minuten)">
            <DebouncedInput
              type="number"
              min={5}
              step={5}
              value={mainCfg.swarmWindowMin ?? DEFAULT_SWARM_WINDOW_MIN}
              onCommit={(raw) => {
                const v = parseInt(raw, 10);
                if (!isNaN(v) && v >= 1)
                  updateMainConfig(deviceId, { swarmWindowMin: v });
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
            />
            <Hint>
              Standard 30 min. Der Sturz muss innerhalb dieser Zeit passieren.
            </Hint>
          </Field>
        </div>
      </Section>

      <FirmwareSection
        deviceId={deviceId}
        device={device}
        mainCfg={mainCfg}
      />

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
        onDashboard={mainCfg.bme280OnDashboard ?? false}
        onDashboardChange={(v) =>
          updateMainConfig(deviceId, { bme280OnDashboard: v })
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
        onDashboard={mainCfg.inaBatteryOnDashboard ?? false}
        onDashboardChange={(v) =>
          updateMainConfig(deviceId, { inaBatteryOnDashboard: v })
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
            busy={
              mainCfg.inaSolarEnabled
                ? mainCfg.inaSolarAddr ?? DEFAULT_INA_SOLAR_ADDR
                : undefined
            }
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
        onDashboard={mainCfg.inaSolarOnDashboard ?? false}
        onDashboardChange={(v) =>
          updateMainConfig(deviceId, { inaSolarOnDashboard: v })
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
            busy={
              mainCfg.inaBatteryEnabled
                ? mainCfg.inaBatteryAddr ?? DEFAULT_INA_BATTERY_ADDR
                : undefined
            }
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
        onDashboard={mainCfg.rainOnDashboard ?? false}
        onDashboardChange={(v) =>
          updateMainConfig(deviceId, { rainOnDashboard: v })
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
            Analog-Ausgang (AO) an ADC1 (GPIO 1–10). Skala: trocken ≈ hoch
            (~4095), je nasser desto niedriger, klatschnass ≈ 0. Sensor mit
            3,3 V versorgen (nicht 5 V – sonst zu hohe Spannung am ADC).
          </Hint>
        </Field>
      </SensorSection>

      <SensorSection
        title="Wake-Button"
        subtitle="Externer Taster. 1× drücken = sofort aufwachen & messen. 2× drücken = Messpause (zum Arbeiten an den Bienen)."
        enabled={mainCfg.wakeButtonEnabled ?? false}
        onEnabledChange={(v) =>
          updateMainConfig(deviceId, { wakeButtonEnabled: v })
        }
        statusLines={[]}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="GPIO">
            <PinSelect
              value={mainCfg.wakeButtonPin ?? DEFAULT_WAKE_PIN}
              allowed={ALLOWED_WAKE_PINS}
              onChange={(v) =>
                updateMainConfig(deviceId, { wakeButtonPin: v })
              }
              pinOwners={pinOwners}
              ownerKey="Wake-Button"
            />
          </Field>
          <Field label="Trigger-Level">
            <select
              value={mainCfg.wakeButtonLevel ?? 0}
              onChange={(e) =>
                updateMainConfig(deviceId, {
                  wakeButtonLevel: parseInt(e.target.value, 10),
                })
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
                if (!isNaN(v) && v >= 1)
                  updateMainConfig(deviceId, {
                    wakePauseMin: Math.min(1440, v),
                  });
              }}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </Field>
        </div>
        <Hint>
          Bei Doppelklick blinkt die Onboard-LED grün und der ESP pausiert
          die eingestellte Zeit (kein Wiegen). Ein einzelner Druck während
          der Pause beendet sie sofort. Wirkt ab dem nächsten Deep-Sleep;
          Taster gegen GND ist die einfachste Variante.
        </Hint>
      </SensorSection>
    </div>
  );
}

function FirmwareSection({
  deviceId,
  device,
  mainCfg,
}: {
  deviceId: string;
  device: Device | null;
  mainCfg: MainConfig;
}) {
  const current = device?.firmwareVersion;
  const latest = device?.latestFirmwareVersion;
  const url = device?.latestFirmwareUrl;
  const updateAvailable = isNewerVersion(current, latest);
  const autoUpdate = mainCfg.autoUpdateEnabled ?? false;
  const deepSleep = mainCfg.deepSleepEnabled ?? true;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoStatus, setAutoStatus] = useState<string | null>(null);

  // Auto-Update: command einmal pro neuer Version ausloesen. Der ESP holt
  // es beim naechsten Wakeup ab; localStorage merkt sich, dass wir fuer
  // diese Version schon ausgeloest haben (verhindert Spam bei reloads).
  useEffect(() => {
    if (!autoUpdate || !updateAvailable || !url || !latest) return;
    if (typeof window === "undefined") return;
    const key = `stockwaage.autoupdate.v2.${deviceId}`;
    const already = window.localStorage.getItem(key);
    if (already === latest) {
      setAutoStatus(`Auto-Update für ${latest} wurde bereits beauftragt.`);
      return;
    }
    sendCommand(deviceId, {
      type: "update",
      payload: { url: firmwareBinUrl(latest), version: latest },
    })
      .then(() => {
        window.localStorage.setItem(key, latest);
        setAutoStatus(
          deepSleep
            ? `Auto-Update auf ${latest} beauftragt. Der ESP installiert es ` +
                `beim nächsten Aufwachen – mit dem Wake-Button geht es sofort.`
            : `Auto-Update auf ${latest} beauftragt. Deep Sleep ist aus – ` +
                `der ESP installiert es in wenigen Sekunden.`,
        );
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
  }, [autoUpdate, updateAvailable, url, latest, deviceId, deepSleep]);

  async function triggerUpdate() {
    if (!url || !latest) return;
    if (
      !confirm(
        `Firmware-Update auf ${latest} beauftragen?\n\n` +
          (deepSleep
            ? `Der ESP lädt die neue Version beim nächsten Aufwachen von ` +
              `GitHub und startet neu (~1–2 Min) – mit dem Wake-Button sofort. `
            : `Deep Sleep ist aus: Der ESP lädt die neue Version innerhalb ` +
              `weniger Sekunden von GitHub und startet neu (~1–2 Min). `) +
          `Stromversorgung in der Zeit nicht unterbrechen.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await sendCommand(deviceId, {
        type: "update",
        payload: { url: firmwareBinUrl(latest), version: latest },
      });
      if (typeof window !== "undefined" && latest) {
        window.localStorage.setItem(
          `stockwaage.autoupdate.v2.${deviceId}`,
          latest,
        );
      }
      setAutoStatus(
        deepSleep
          ? `Update auf ${latest} beauftragt. Der ESP installiert es beim ` +
              `nächsten Aufwachen – mit dem Wake-Button geht es sofort.`
          : `Update auf ${latest} beauftragt. Deep Sleep ist aus – der ESP ` +
              `installiert es in wenigen Sekunden.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Firmware">
      <div className="grid gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-neutral-500">Installiert</span>
          <span className="font-mono">{current ?? "—"}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-neutral-500">Neueste auf GitHub</span>
          <span className="font-mono">
            {latest ?? "—"}
            {latest && !updateAvailable && current && (
              <span className="ml-2 text-xs text-green-700">✓ aktuell</span>
            )}
          </span>
        </div>

        <label className="mt-2 flex items-start gap-2">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) =>
              updateMainConfig(deviceId, {
                autoUpdateEnabled: e.target.checked,
              })
            }
            className="mt-1"
          />
          <span className="text-sm">
            Neue Firmware automatisch installieren
            <span className="mt-0.5 block text-xs text-neutral-500">
              Der ESP zieht neue Releases beim Aufwachen selbst. Zusätzlich
              schickt das UI den Auftrag, sobald es ein Release sieht.
            </span>
          </span>
        </label>

        {updateAvailable && url && (
          <button
            type="button"
            onClick={triggerUpdate}
            disabled={busy}
            className="mt-2 w-full rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {busy ? "Auftrag wird gesendet…" : `Firmware ${latest} installieren`}
          </button>
        )}

        {autoStatus && (
          <p className="text-xs text-neutral-600">{autoStatus}</p>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
        <p className="text-xs text-neutral-500">
          {deepSleep ? (
            <>
              Der ESP prüft bei jedem Aufwachen auf neue Releases und
              installiert sie dann sofort (vor der Messung), sofern
              Auto-Update an ist oder ein Update beauftragt wurde. Da er
              meist schläft: <strong>Wake-Button drücken oder ESP neu
              starten → Update läuft sofort → fertig.</strong> Der Auftrag
              liegt in Firestore, das UI muss nicht offen bleiben.
            </>
          ) : (
            <>
              <strong>Deep Sleep ist aus</strong> – der ESP bleibt wach und
              holt beauftragte Updates innerhalb weniger Sekunden ab und
              installiert sie (danach Neustart ~1–2 Min). Der Auftrag liegt in
              Firestore, das UI muss nicht offen bleiben.
            </>
          )}
        </p>
      </div>
    </Section>
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
  onDashboard,
  onDashboardChange,
  children,
}: {
  title: string;
  subtitle?: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  statusLines: Array<string | null>;
  // Optional: Stern zum Anzeigen einer Graph-Kachel auf dem Dashboard.
  onDashboard?: boolean;
  onDashboardChange?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const status = statusLines.filter((s): s is string => !!s).join(" · ");
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-2">
        <label className="flex flex-1 items-start gap-3">
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
        {enabled && onDashboardChange && (
          <StarToggle
            on={!!onDashboard}
            onClick={() => onDashboardChange(!onDashboard)}
          />
        )}
      </div>
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
