"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { devicePath, sendCommand, type Command } from "@/lib/devices";

// Per-Gerät-"Wach halten" zum Testen/Kalibrieren: schickt einen stayAwake-
// Befehl NUR an dieses Geraet (die anderen schlafen weiter und sparen Akku).
// Laeuft automatisch ab -> kein Dauer-Wach-Modus, der den Akku leert.
// Der ESP haelt stayAwakeUntilMs nur in-memory; den Countdown fuehren wir
// daher lokal ab dem Moment, in dem der ESP den Befehl bestaetigt hat.

const DURATIONS = [15, 30, 60] as const;

export default function KeepAwakeControl({
  deviceId,
  awakeUntil,
  onChange,
}: {
  deviceId: string;
  awakeUntil: number; // ms-Epoch; 0 = schlaeft normal
  onChange: (until: number) => void;
}) {
  const [cmdId, setCmdId] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "wake" | "sleep">(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [, tick] = useState(0);
  const wakeDurRef = useRef(0);

  const remaining = Math.max(0, awakeUntil - Date.now());
  const awake = remaining > 0;

  // Sekuendlicher Re-Render fuer den Countdown + Auto-Reset bei Ablauf.
  useEffect(() => {
    if (!awake) return;
    const id = setInterval(() => {
      if (awakeUntil - Date.now() <= 0) onChange(0);
      else tick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [awake, awakeUntil, onChange]);

  // Auf die Bestaetigung des laufenden Befehls warten.
  useEffect(() => {
    if (!cmdId) return;
    const ref = doc(db, ...devicePath(deviceId), "commands", cmdId);
    return onSnapshot(ref, (snap) => {
      const d = snap.data() as Command | undefined;
      if (!d) return;
      if (d.status === "done") {
        if (pending === "wake") onChange(Date.now() + wakeDurRef.current);
        else if (pending === "sleep") onChange(0);
        setPending(null);
        setCmdId(null);
      } else if (d.status === "error") {
        setError(d.error ?? "Unbekannter Fehler");
        setPending(null);
        setCmdId(null);
      }
    });
  }, [cmdId, deviceId, pending, onChange]);

  useEffect(() => {
    setSlow(false);
    if (!cmdId) return;
    const t = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(t);
  }, [cmdId]);

  async function fire(kind: "wake" | "sleep", min: number) {
    setError(null);
    wakeDurRef.current = min * 60_000;
    setPending(kind);
    try {
      const id = await sendCommand(deviceId, {
        type: "stayAwake",
        payload: { durationMs: min * 60_000 },
      });
      setCmdId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              awake ? "animate-pulse bg-amber-500" : "bg-neutral-300"
            }`}
          />
          <span className="text-sm font-medium">
            {awake ? (
              <>
                Wach –{" "}
                <span className="font-mono tabular-nums">
                  {fmtRemaining(remaining)}
                </span>
              </>
            ) : pending === "wake" ? (
              "ESP wird geweckt…"
            ) : pending === "sleep" ? (
              "Schlafen lassen…"
            ) : (
              "Testmodus · Wach halten"
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {awake ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => fire("wake", 30)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
              >
                +30 min
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => fire("sleep", 0)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50"
              >
                Schlafen lassen
              </button>
            </>
          ) : (
            DURATIONS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => fire("wake", m)}
                className="rounded bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {busy && pending === "wake" ? "…" : `${m} min`}
              </button>
            ))
          )}
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-neutral-500">
        Hält <strong>nur dieses Gerät</strong> wach (zum Testen/Kalibrieren) –
        die anderen schlafen weiter. Läuft automatisch ab.
      </p>

      {pending === "wake" && slow && (
        <p className="mt-1 text-[11px] text-amber-700">
          Noch keine Antwort – bei aktivem Schlafmodus reagiert der ESP erst
          beim nächsten Aufwachen (bis ~Intervall). Der Reset-/Wake-Taster am
          ESP beschleunigt es.
        </p>
      )}
      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}

function fmtRemaining(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
