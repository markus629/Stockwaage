"use client";

import { useEffect, useState } from "react";
import {
  BME280_ADDRS,
  DEFAULT_BME280_ADDR,
  DEFAULT_SWARM_DROP_KG,
  DEFAULT_SWARM_WINDOW_MIN,
  firmwareBinUrl,
  isNewerVersion,
  sendCommand,
  updateMainConfig,
  type Device,
  type MainConfig,
  type Reading,
} from "@/lib/devices";
import DebouncedInput from "./DebouncedInput";
import StarToggle from "./StarToggle";
import { FEED_STEP_THRESHOLD_KG } from "@/lib/analysis";

type Props = {
  deviceId: string;
  device: Device | null;
  mainCfg: MainConfig;
  latest: Reading | null;
  intervalSecFallback?: number;
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
}: Props) {
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

      <Section
        title="Futter-Tracker"
        subtitle="Für die Futter-Reichweite: wie groß darf eine Tagesänderung sein, damit sie noch als Verbrauch zählt? Größere Sprünge (Füttern, Fütterer abnehmen, Durchsicht) werden ignoriert."
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
                if (!isNaN(v) && v > 0)
                  updateMainConfig(deviceId, { feedStepThresholdKg: v });
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

      <FirmwareSection
        deviceId={deviceId}
        device={device}
        mainCfg={mainCfg}
      />
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
