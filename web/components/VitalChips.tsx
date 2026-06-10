"use client";

import type { Device, Reading } from "@/lib/devices";

// Vitalwerte eines Geraets als kompakte Chips: Temperatur, Akku, Solar, Regen.
// Chips erscheinen nur, wenn der jeweilige Wert im letzten Reading vorhanden
// ist – so passt dieselbe Komponente fuer S3 (volle Sensorik) und C5 (schlank).
export default function VitalChips({
  device,
  reading,
}: {
  device: Device | null;
  reading: Reading | null;
}) {
  const chips: Array<{ icon: string; label: string; title: string }> = [];
  if (reading?.ambientC !== undefined) {
    chips.push({
      icon: "🌡",
      label: `${reading.ambientC.toFixed(1)} °C`,
      title: "Temperatur (BMP280)",
    });
  }
  const vBat = reading?.batteryV ?? device?.vBat ?? reading?.vBat;
  if (vBat !== undefined) {
    const mA =
      reading?.batteryA !== undefined
        ? ` · ${(reading.batteryA * 1000).toFixed(0)} mA`
        : "";
    chips.push({
      icon: "🔋",
      label: `${vBat.toFixed(2)} V${mA}`,
      title: "Akku",
    });
  }
  if (reading?.solarV !== undefined) {
    const mA =
      reading?.solarA !== undefined
        ? ` · ${(reading.solarA * 1000).toFixed(0)} mA`
        : "";
    chips.push({
      icon: "☀️",
      label: `${reading.solarV.toFixed(2)} V${mA}`,
      title: "Solar (INA219)",
    });
  }
  if (reading?.rainRaw !== undefined) {
    // Skala: trocken ≈ 4095, klatschnass ≈ 0.
    const wet = Math.max(0, Math.min(100, (1 - reading.rainRaw / 4095) * 100));
    chips.push({
      icon: "🌧",
      label: `${wet.toFixed(0)} % nass`,
      title: `Regensensor (Rohwert ${reading.rainRaw})`,
    });
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.title}
          title={c.title}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-xs text-neutral-600"
        >
          <span aria-hidden>{c.icon}</span>
          <span className="font-mono tabular-nums">{c.label}</span>
        </span>
      ))}
    </div>
  );
}
