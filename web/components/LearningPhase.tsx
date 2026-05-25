"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  devicePath,
  linearRegression,
  sendCommand,
  updateScaleConfig,
  clearScaleLearning,
  LEARNING_MIN_RANGE_C,
  LEARNING_MIN_POINTS,
  LEARNING_MIN_R2,
  type Reading,
  type ScaleConfig,
} from "@/lib/devices";

type Props = {
  deviceId: string;
  scale: ScaleConfig;
};

type Sample = { ts: number; raw: number; tempC: number };

export default function LearningPhase({ deviceId, scale }: Props) {
  const learningStartedAt = scale.learning?.startedAt;
  const [progress, setProgress] = useState<{
    n: number;
    minT: number;
    maxT: number;
  } | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<{
    slope: number;
    refC: number;
    rSquared: number;
    n: number;
    rangeC: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Während Lernphase läuft: live mitzählen via readings subscription
  useEffect(() => {
    setError(null);
    setResult(null);
    if (!learningStartedAt) {
      setProgress(null);
      return;
    }
    const q = query(
      collection(db, ...devicePath(deviceId), "readings"),
      where("ts", ">=", learningStartedAt),
      orderBy("ts", "asc"),
    );
    return onSnapshot(q, (snap) => {
      const samples = collectSamples(snap.docs.map((d) => d.data() as Reading), scale.id);
      if (samples.length === 0) {
        setProgress({ n: 0, minT: NaN, maxT: NaN });
        return;
      }
      const ts = samples.map((s) => s.tempC);
      setProgress({
        n: samples.length,
        minT: Math.min(...ts),
        maxT: Math.max(...ts),
      });
    });
  }, [learningStartedAt, deviceId, scale.id]);

  async function start() {
    setError(null);
    try {
      await updateScaleConfig(deviceId, scale.id, {
        learning: { startedAt: Date.now() },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function evaluate() {
    if (!learningStartedAt) return;
    setEvaluating(true);
    setError(null);
    setResult(null);
    try {
      const snap = await getDocs(
        query(
          collection(db, ...devicePath(deviceId), "readings"),
          where("ts", ">=", learningStartedAt),
          orderBy("ts", "asc"),
        ),
      );
      const samples = collectSamples(
        snap.docs.map((d) => d.data() as Reading),
        scale.id,
      );
      if (samples.length < LEARNING_MIN_POINTS) {
        setError(
          `Zu wenige Datenpunkte: ${samples.length}/${LEARNING_MIN_POINTS}. ` +
            `Weiter messen, dann erneut versuchen.`,
        );
        return;
      }
      const reg = linearRegression(
        samples.map((s) => ({ x: s.tempC, y: s.raw })),
      );
      if (!reg) {
        setError("Konnte keine Regression rechnen.");
        return;
      }
      if (reg.rangeX < LEARNING_MIN_RANGE_C) {
        setError(
          `Temperatur-Spanne nur ${reg.rangeX.toFixed(1)} °C (mindestens ` +
            `${LEARNING_MIN_RANGE_C} °C nötig). Weiter messen, dann erneut ` +
            `versuchen.`,
        );
        return;
      }
      if (reg.rSquared < LEARNING_MIN_R2) {
        setError(
          `Schlechter Zusammenhang (R²=${reg.rSquared.toFixed(2)}, ` +
            `min ${LEARNING_MIN_R2}). Möglicherweise schwankte das Gewicht – ` +
            `Lernphase mit konstantem Gewicht wiederholen.`,
        );
        return;
      }
      setResult({
        slope: reg.slope,
        refC: reg.meanX,
        rSquared: reg.rSquared,
        n: reg.n,
        rangeC: reg.rangeX,
      });
    } finally {
      setEvaluating(false);
    }
  }

  async function applyResult() {
    if (!result) return;
    setError(null);
    try {
      await sendCommand(deviceId, {
        type: "setTempCoef",
        scaleId: scale.id,
        payload: { tempCoef: result.slope, tempRefC: result.refC },
      });
      // Lernphase beenden
      await clearScaleLearning(deviceId, scale.id);
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function discardResult() {
    setResult(null);
  }

  async function cancelLearning() {
    setError(null);
    setResult(null);
    try {
      await clearScaleLearning(deviceId, scale.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      {!learningStartedAt && (
        <>
          <p className="mb-2 text-xs text-neutral-600">
            Aktueller Koeffizient:{" "}
            <span className="font-mono">
              {(scale.tempCoef ?? 0).toFixed(2)} raw/°C
            </span>
            {" @ "}
            <span className="font-mono">
              {(scale.tempRefC ?? 20).toFixed(1)} °C
            </span>
          </p>
          <button
            onClick={start}
            className="w-full rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Lernphase für Temperaturkompensation beginnen
          </button>
        </>
      )}

      {learningStartedAt && !result && (
        <>
          <p className="mb-2 text-xs text-neutral-600">
            Läuft seit{" "}
            {new Date(learningStartedAt).toLocaleString("de-DE", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
          {progress && (
            <ul className="mb-2 space-y-0.5 text-xs">
              <li>
                Datenpunkte:{" "}
                <span className="font-mono">{progress.n}</span>
                {" / "}
                <span className="text-neutral-500">
                  min {LEARNING_MIN_POINTS}
                </span>
              </li>
              <li>
                Temp-Spanne:{" "}
                <span className="font-mono">
                  {isFinite(progress.minT)
                    ? (progress.maxT - progress.minT).toFixed(1)
                    : "—"}{" "}
                  °C
                </span>{" "}
                {isFinite(progress.minT) && (
                  <span className="text-neutral-500">
                    ({progress.minT.toFixed(1)} ... {progress.maxT.toFixed(1)} °C)
                  </span>
                )}{" "}
                / <span className="text-neutral-500">min {LEARNING_MIN_RANGE_C} °C</span>
              </li>
            </ul>
          )}
          <div className="flex gap-2">
            <button
              onClick={evaluate}
              disabled={evaluating}
              className="flex-1 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {evaluating ? "Auswerten..." : "Lernphase beenden"}
            </button>
            <button
              onClick={cancelLearning}
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              Abbrechen
            </button>
          </div>
        </>
      )}

      {result && (
        <>
          <p className="mb-2 text-xs text-neutral-600">
            Vorschlag:
          </p>
          <ul className="mb-2 space-y-0.5 text-xs">
            <li>
              Koeffizient:{" "}
              <span className="font-mono">
                {result.slope.toFixed(2)} raw/°C
              </span>
            </li>
            <li>
              Referenztemperatur:{" "}
              <span className="font-mono">{result.refC.toFixed(2)} °C</span>
            </li>
            <li>
              R²:{" "}
              <span className="font-mono">{result.rSquared.toFixed(3)}</span>{" "}
              · n={result.n} · Spanne {result.rangeC.toFixed(1)} °C
            </li>
          </ul>
          <div className="flex gap-2">
            <button
              onClick={applyResult}
              className="flex-1 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700"
            >
              Übernehmen
            </button>
            <button
              onClick={discardResult}
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              Verwerfen
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}

function collectSamples(readings: Reading[], scaleId: string): Sample[] {
  const out: Sample[] = [];
  for (const r of readings) {
    const s = r.scales?.[scaleId];
    if (!s || typeof s.raw !== "number") continue;
    if (typeof r.ambientC !== "number") continue;
    out.push({ ts: r.ts, raw: s.raw, tempC: r.ambientC });
  }
  return out;
}
