"use client";

import { useEffect, useMemo, useState } from "react";
import {
  doc,
  onSnapshot,
  query,
  collection,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  commandsCol,
  devicePath,
  sendCommand,
  type Command,
  type ScaleConfig,
} from "@/lib/devices";

type Props = {
  deviceId: string;
  scale: ScaleConfig;
  latestRaw?: number;
  deepSleep: boolean;
  onClose: () => void;
};

type Step = "stayAwake" | "tare" | "weight" | "done";

export default function CalibrationWizard({
  deviceId,
  scale,
  latestRaw,
  deepSleep,
  onClose,
}: Props) {
  // Bei ausgeschaltetem Deep Sleep ist der ESP wach und pollt Commands im
  // Sekundentakt -> der "wachkuessen"-Schritt entfaellt, wir starten direkt
  // bei der Tare.
  const [step, setStep] = useState<Step>(deepSleep ? "stayAwake" : "tare");
  const [pendingCmdId, setPendingCmdId] = useState<string | null>(null);
  const [pendingCmd, setPendingCmd] = useState<Command | null>(null);
  const [knownKg, setKnownKg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  // Subscribe auf den aktuell laufenden Command, um done/error zu sehen
  useEffect(() => {
    if (!pendingCmdId) {
      setPendingCmd(null);
      return;
    }
    const ref = doc(
      db,
      ...devicePath(deviceId),
      "commands",
      pendingCmdId,
    );
    return onSnapshot(ref, (snap) => {
      const d = snap.data();
      if (d) setPendingCmd({ id: snap.id, ...(d as Omit<Command, "id">) });
    });
  }, [pendingCmdId, deviceId]);

  // Step-Übergänge bei Command-Done
  useEffect(() => {
    if (!pendingCmd) return;
    if (pendingCmd.status === "done") {
      if (pendingCmd.type === "stayAwake") setStep("tare");
      else if (pendingCmd.type === "tare") setStep("weight");
      else if (pendingCmd.type === "calibrate") setStep("done");
      setPendingCmdId(null);
    } else if (pendingCmd.status === "error") {
      setError(pendingCmd.error ?? "Unbekannter Fehler");
      setPendingCmdId(null);
    }
  }, [pendingCmd]);

  // Wartet zu lange? Nach ein paar Sekunden einen Hinweis einblenden, damit
  // der Wizard nicht stumm "ewig" haengt.
  useEffect(() => {
    setSlow(false);
    if (!pendingCmdId) return;
    const t = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(t);
  }, [pendingCmdId]);

  async function fire(
    type: Command["type"],
    payload?: Command["payload"],
    scaleId?: string,
  ) {
    setError(null);
    try {
      const id = await sendCommand(deviceId, { type, scaleId, payload });
      setPendingCmdId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const waiting = pendingCmd?.status === "pending" || pendingCmdId !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Kalibrieren · {scale.name || scale.id}
          </h3>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {waiting && slow && (
          <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            Noch keine Antwort vom ESP.{" "}
            {deepSleep
              ? "Bei aktivem Deep Sleep reagiert er erst beim nächsten Aufwachen – drück den Wake-/Reset-Taster am ESP, um es zu beschleunigen."
              : "Prüfe, ob der ESP online ist (auf der Geräteseite „zuletzt gesehen“ / grüner Punkt). Hat er Deep Sleep gerade erst ausgeschaltet, wacht er evtl. noch einmal auf – kurz den Reset-Taster drücken hilft."}
          </div>
        )}

        {step === "stayAwake" && (
          <>
            <p className="mb-3 text-sm text-neutral-700">
              Der ESP muss erst aufwachen, damit der Wizard interaktiv läuft.
              Klick "ESP wachküssen" und warte (bis zum nächsten Wakeup, max{" "}
              {/* duration label */}~15 min). Du kannst das beschleunigen indem
              du den Reset-Taster am ESP drückst.
            </p>
            <Step1Button
              waiting={waiting}
              onClick={() => fire("stayAwake", { durationMs: 600000 })}
            />
          </>
        )}

        {step === "tare" && (
          <>
            <p className="mb-3 text-sm text-neutral-700">
              <strong>Schritt 1:</strong> Bitte stelle sicher, dass die Waage{" "}
              <em>leer</em> ist (kein Gewicht oder nur die leere Beute, wenn
              das deine 0&nbsp;kg-Referenz sein soll).
            </p>
            <Info label="Aktueller Rohwert" value={fmtRaw(latestRaw)} />
            <button
              disabled={waiting}
              onClick={() => fire("tare", undefined, scale.id)}
              className="mt-3 w-full rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {waiting ? "Warte auf ESP..." : "Tare ausführen"}
            </button>
          </>
        )}

        {step === "weight" && (
          <>
            <p className="mb-3 text-sm text-neutral-700">
              <strong>Schritt 2:</strong> Lege ein bekanntes Gewicht auf
              (z.B. 10 kg Eimer Wasser oder eine Hantelscheibe). Gib das
              Gewicht in kg ein.
            </p>
            <Info label="Aktueller Rohwert" value={fmtRaw(latestRaw)} />
            <Info label="Tare (offset)" value={fmtRaw(scale.offset ?? 0)} />
            <label className="mt-3 block text-sm">
              Referenzgewicht (kg)
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={knownKg}
                onChange={(e) => setKnownKg(e.target.value)}
                placeholder="z.B. 10.000"
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <button
              disabled={waiting || !knownKg || parseFloat(knownKg) <= 0}
              onClick={() =>
                fire(
                  "calibrate",
                  { knownKg: parseFloat(knownKg) },
                  scale.id,
                )
              }
              className="mt-3 w-full rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {waiting ? "Warte auf ESP..." : "Kalibrieren"}
            </button>
          </>
        )}

        {step === "done" && (
          <>
            <p className="mb-3 text-sm text-neutral-700">
              ✓ Kalibrierung gespeichert. Die Waage zeigt ab jetzt kg.
            </p>
            <Info label="Tare (offset)" value={fmtRaw(scale.offset ?? 0)} />
            <Info
              label="Skalierfaktor (raw/kg)"
              value={fmtRaw(scale.scaleFactor ?? 0)}
            />
            <button
              onClick={onClose}
              className="mt-3 w-full rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-700"
            >
              Schließen
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Step1Button({
  waiting,
  onClick,
}: {
  waiting: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={waiting}
      onClick={onClick}
      className="w-full rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-700 disabled:opacity-50"
    >
      {waiting ? "Warte auf ESP-Bestätigung..." : "ESP wachküssen"}
    </button>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex justify-between text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function fmtRaw(v: number | undefined): string {
  if (v === undefined) return "—";
  return v.toFixed(0);
}
