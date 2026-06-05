"use client";

import { useState } from "react";
import {
  firmwareBinUrl,
  isNewerVersion,
  sendCommand,
  type Device,
} from "@/lib/devices";

// Fleet-Firmware-Uebersicht: neueste Version (von GitHub, aus den Heartbeats)
// + Liste aller ESPs mit ihrer aktuell installierten Version und Update-Knopf.
export default function FirmwareFleet({ devices }: { devices: Device[] }) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [ordered, setOrdered] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  if (devices.length === 0) return null;

  // Neueste bekannte Version ueber alle Geraete (aus deren Heartbeats).
  const latestFw = devices.reduce<string | undefined>((acc, d) => {
    const v = d.latestFirmwareVersion;
    return v && (!acc || isNewerVersion(acc, v)) ? v : acc;
  }, undefined);

  const rows = devices
    .map((d) => ({
      d,
      updateAvailable: isNewerVersion(d.firmwareVersion, latestFw),
    }))
    .sort((a, b) => a.d.id.localeCompare(b.d.id));
  const anyUpdate = rows.some((r) => r.updateAvailable && !ordered[r.d.id]);

  async function update(d: Device) {
    if (!latestFw || !d.boardType) return;
    setBusy((b) => ({ ...b, [d.id]: true }));
    setError(null);
    try {
      await sendCommand(d.id, {
        type: "update",
        payload: {
          url: firmwareBinUrl(latestFw, d.boardType),
          version: latestFw,
        },
      });
      setOrdered((x) => ({ ...x, [d.id]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [d.id]: false }));
    }
  }

  async function updateAll() {
    for (const r of rows) {
      if (r.updateAvailable && !ordered[r.d.id] && r.d.boardType)
        await update(r.d);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Firmware</h3>
        <span className="text-xs text-neutral-500">
          Neueste auf GitHub:{" "}
          <span className="font-mono">{latestFw ?? "—"}</span>
        </span>
      </div>

      <ul className="divide-y divide-neutral-100">
        {rows.map(({ d, updateAvailable }) => (
          <li key={d.id} className="flex items-center gap-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{d.id}</span>
            <span className="font-mono text-xs text-neutral-500">
              {d.firmwareVersion ?? "—"}
            </span>
            {ordered[d.id] ? (
              <span className="text-xs text-neutral-500">beauftragt</span>
            ) : updateAvailable ? (
              <button
                type="button"
                onClick={() => update(d)}
                disabled={busy[d.id] || !d.boardType}
                title={d.boardType ? undefined : "Geräte-Typ noch unbekannt"}
                className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {busy[d.id] ? "…" : "aktualisieren"}
              </button>
            ) : (
              <span className="text-xs text-green-700">✓ aktuell</span>
            )}
          </li>
        ))}
      </ul>

      {anyUpdate && (
        <button
          type="button"
          onClick={updateAll}
          className="mt-2 w-full rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
        >
          Alle aktualisieren
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-[10px] text-neutral-400">
        Der Auftrag liegt in Firestore; der ESP installiert ihn beim nächsten
        Aufwachen (mit Deep Sleep aus: in Sekunden).
      </p>
    </section>
  );
}
