import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db, ownerUid } from "./firebase";

// ----- Types ----------------------------------------------------------------

export type Device = {
  id: string;
  deviceId?: string;
  lastSeen?: number;
  vBat?: number;
  intervalSec?: number;
};

export type MainConfig = {
  intervalSec?: number;
  ambientTempAddr?: string;
  stayAwakeUntilMs?: number;
};

export type ScaleConfig = {
  id: string; // "s1".."s8"
  enabled?: boolean;
  name?: string;
  offset?: number;
  scaleFactor?: number;
  tempCoef?: number;
  tempRefC?: number;
  dtPin?: number;
  learning?: { startedAt: number };
};

export type ScaleReading = { raw: number; kg?: number };

export type Reading = {
  ts: number;
  vBat?: number;
  boots?: number;
  ambientC?: number;
  scales: Record<string, ScaleReading>;
  temps: Record<string, number>;
};

export type CommandStatus = "pending" | "done" | "error";
export type CommandType =
  | "tare"
  | "calibrate"
  | "setTempCoef"
  | "stayAwake"
  | "reload";

export type Command = {
  id: string;
  type: CommandType;
  scaleId?: string;
  payload?: Record<string, number | string | boolean>;
  status: CommandStatus;
  error?: string;
  createdAt: number;
  processedAt?: number;
};

// ----- Firestore paths ------------------------------------------------------

export const MAX_SCALES = 8;
export const SCALE_SLOTS = Array.from(
  { length: MAX_SCALES },
  (_, i) => `s${i + 1}`,
);

// ESP32 GPIOs die als HX711-DT (Input) sicher nutzbar sind.
// Reserviert: 0 (Portal-Button), 1/3 (Serial), 4 (HX711 SCK), 6-11 (Flash),
// 12 (Boot-Strap LOW), 23 (OneWire), 32 (VBat).
export const ALLOWED_DT_PINS = [
  5, 13, 14, 15, 16, 17, 18, 19, 21, 22, 25, 26, 27, 33,
] as const;

// Default-Pinbelegung pro Slot, identisch zur ESP-Firmware (config.h).
export const DEFAULT_DT_PIN: Record<string, number> = {
  s1: 13, s2: 14, s3: 16, s4: 17,
  s5: 18, s6: 19, s7: 21, s8: 22,
};

export const devicePath = (deviceId: string) =>
  ["users", ownerUid, "devices", deviceId] as const;

export const devicesCol = () => collection(db, "users", ownerUid, "devices");
export const deviceDoc = (id: string) => doc(db, ...devicePath(id));
export const mainConfigDoc = (id: string) =>
  doc(db, ...devicePath(id), "config", "main");
export const scaleDoc = (id: string, scaleId: string) =>
  doc(db, ...devicePath(id), "scales", scaleId);
export const scalesCol = (id: string) =>
  collection(db, ...devicePath(id), "scales");
export const readingsCol = (id: string) =>
  collection(db, ...devicePath(id), "readings");
export const commandsCol = (id: string) =>
  collection(db, ...devicePath(id), "commands");

// ----- Helpers --------------------------------------------------------------

export async function sendCommand(
  deviceId: string,
  cmd: Omit<Command, "id" | "status" | "createdAt">,
): Promise<string> {
  const data: Record<string, unknown> = {
    status: "pending",
    createdAt: Date.now(),
    createdAtServer: serverTimestamp(),
  };
  for (const [k, v] of Object.entries(cmd)) {
    if (v !== undefined) data[k] = v;
  }
  const ref = await addDoc(commandsCol(deviceId), data);
  return ref.id;
}

export async function updateScaleConfig(
  deviceId: string,
  scaleId: string,
  patch: Partial<ScaleConfig>,
): Promise<void> {
  await setDoc(scaleDoc(deviceId, scaleId), patch, { merge: true });
}

export async function clearScaleLearning(
  deviceId: string,
  scaleId: string,
): Promise<void> {
  await updateDoc(scaleDoc(deviceId, scaleId), { learning: deleteField() });
}

export async function updateMainConfig(
  deviceId: string,
  patch: Partial<MainConfig>,
): Promise<void> {
  await setDoc(mainConfigDoc(deviceId), patch, { merge: true });
}

export async function addScale(
  deviceId: string,
  existingIds: Iterable<string>,
): Promise<string | null> {
  const taken = new Set(existingIds);
  const nextSlot = SCALE_SLOTS.find((s) => !taken.has(s));
  if (!nextSlot) return null;
  await setDoc(scaleDoc(deviceId, nextSlot), {
    dtPin: DEFAULT_DT_PIN[nextSlot],
  });
  return nextSlot;
}

export async function removeScale(
  deviceId: string,
  scaleId: string,
): Promise<void> {
  await deleteDoc(scaleDoc(deviceId, scaleId));
}

// ----- Math ------------------------------------------------------------------

export type Regression = {
  slope: number;
  intercept: number;
  meanX: number;
  meanY: number;
  rSquared: number;
  n: number;
  rangeX: number;
};

export function linearRegression(
  points: ReadonlyArray<{ x: number; y: number }>,
): Regression | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0) return null;
  const slope = num / denX;
  const intercept = meanY - slope * meanX;
  const rSquared = denY === 0 ? 0 : (num * num) / (denX * denY);
  const xs = points.map((p) => p.x);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  return { slope, intercept, meanX, meanY, rSquared, n, rangeX };
}

export const LEARNING_MIN_RANGE_C = 5;
export const LEARNING_MIN_POINTS = 30;
export const LEARNING_MIN_R2 = 0.5;
