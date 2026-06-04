"use client";

import {
  updateGlobalConfig,
  type MainConfig,
} from "@/lib/devices";
import { FEED_STEP_THRESHOLD_KG } from "@/lib/analysis";
import DebouncedInput from "./DebouncedInput";

// GLOBALE Einstellungen – gelten fuer ALLE ESPs (ein Dokument). Kalibrierung
// ist davon ausgenommen (pro Waage, siehe Detailseite).
type Props = {
  mainCfg: MainConfig;
};

export default function SettingsPanel({ mainCfg }: Props) {
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
            onChange={(e) =>
              updateGlobalConfig({ deepSleepEnabled: e.target.checked })
            }
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
            onChange={(e) =>
              updateGlobalConfig({ autoUpdateEnabled: e.target.checked })
            }
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
                if (!isNaN(v) && v >= 30)
                  updateGlobalConfig({ intervalSec: v });
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
                if (!isNaN(v) && v > 0)
                  updateGlobalConfig({ feedStepThresholdKg: v });
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
