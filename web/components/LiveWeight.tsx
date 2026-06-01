"use client";

import type { ScaleReading } from "@/lib/devices";

// Kompakte Live-Anzeige des aktuell gemessenen Gewichts einer Waage.
// Speist sich aus dem zuletzt geschriebenen Reading (live-Listener) und
// aktualisiert daher mit jedem Messintervall. Praktisch zum Testen:
// zeigt kg (falls kalibriert) und immer den Rohwert.
export default function LiveWeight({ reading }: { reading?: ScaleReading }) {
  const kg = reading?.kg;
  const raw = reading?.raw;
  const hasKg = typeof kg === "number" && isFinite(kg);
  const hasRaw = typeof raw === "number" && isFinite(raw);

  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">
        Aktuell
      </span>
      {hasKg ? (
        <span className="font-mono text-lg font-semibold tabular-nums">
          {kg!.toFixed(2)} kg
        </span>
      ) : hasRaw ? (
        <span className="font-mono text-sm text-neutral-500">
          nicht kalibriert
        </span>
      ) : (
        <span className="font-mono text-sm text-neutral-400">—</span>
      )}
      {hasRaw && (
        <span className="ml-auto font-mono text-xs text-neutral-400 tabular-nums">
          raw {raw!.toFixed(0)}
        </span>
      )}
    </div>
  );
}
