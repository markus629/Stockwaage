"use client";

import { useEffect, useState } from "react";

type Props = {
  lastSeen?: number;
  intervalSec?: number;
};

const FALLBACK_INTERVAL_SEC = 900;
const TOLERANCE_FACTOR = 2;
const TICK_MS = 30_000;

// Gleiche Logik wie der Punkt selbst – fuer Zusammenfassungen (z.B. "2/3
// online" im Dashboard-Kopf).
export function isOnline(lastSeen?: number, intervalSec?: number): boolean {
  if (!lastSeen) return false;
  const tolMs =
    (intervalSec ?? FALLBACK_INTERVAL_SEC) * TOLERANCE_FACTOR * 1000;
  return Date.now() - lastSeen < tolMs;
}

export default function OnlineDot({ lastSeen, intervalSec }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (!lastSeen) return null;
  const tolMs = (intervalSec ?? FALLBACK_INTERVAL_SEC) * TOLERANCE_FACTOR * 1000;
  const ageMs = Date.now() - lastSeen;
  const online = ageMs < tolMs;
  const ageMin = Math.round(ageMs / 60000);
  return (
    <span
      title={
        online
          ? `Online (vor ${ageMin} min gesehen)`
          : `Offline (vor ${ageMin} min zuletzt gesehen)`
      }
      className={`ml-1 inline-block h-[0.6em] w-[0.6em] rounded-full align-middle ${
        online ? "bg-green-500" : "bg-red-500"
      }`}
    />
  );
}
