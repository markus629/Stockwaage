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
  firmwareVersion?: string;
  latestFirmwareVersion?: string;
  latestFirmwareUrl?: string;
};

export type MainConfig = {
  intervalSec?: number;
  stayAwakeUntilMs?: number;
  // I2C-Bus (geteilt von BME280 + INA219)
  i2cSda?: number;
  i2cScl?: number;
  // BME280 (Temp/Feuchte/Druck)
  bme280Enabled?: boolean;
  bme280Addr?: number;
  // INA219 fuer Akku-Strom/Spannung
  inaBatteryEnabled?: boolean;
  inaBatteryAddr?: number;
  // INA219 fuer Solar-Strom/Spannung
  inaSolarEnabled?: boolean;
  inaSolarAddr?: number;
  // Regensensor (analog)
  rainEnabled?: boolean;
  rainPin?: number;
};

// ESP32-S3-WROOM-1 N16R8: SPI-Flash 26-32, Octal-PSRAM 33-37, USB 19/20,
// UART0 43/44, Strapping 0/3/45/46, Onboard-LED 48 -> alle nicht in den
// User-Listen. ADC1 = GPIO 1-10.
export const DEFAULT_I2C_SDA = 8;
export const DEFAULT_I2C_SCL = 9;
export const ALLOWED_I2C_PINS = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47,
] as const;
export const BME280_ADDRS = [0x76, 0x77] as const;
export const INA219_ADDRS = [0x40, 0x41, 0x44, 0x45] as const;
// Rain braucht ADC1 (1-10), ohne SCK (4), VBat (1), Strapping (3)
export const ALLOWED_RAIN_PINS = [2, 5, 6, 7, 8, 9, 10] as const;
export const DEFAULT_RAIN_PIN = 2;
export const DEFAULT_BME280_ADDR = 0x76;
export const DEFAULT_INA_BATTERY_ADDR = 0x40;
export const DEFAULT_INA_SOLAR_ADDR = 0x41;

export type ScaleConfig = {
  id: string; // "s1".."s8"
  enabled?: boolean;
  name?: string;
  offset?: number;
  scaleFactor?: number;
  tempCoef?: number;
  tempRefC?: number;
  dtPin?: number;
  onDashboard?: boolean;
  learning?: { startedAt: number };
};

export type ScaleReading = { raw: number; kg?: number };

export type Reading = {
  ts: number;
  vBat?: number;
  boots?: number;
  ambientC?: number;
  ambientHumidity?: number;
  ambientPressure?: number;
  batteryV?: number;
  batteryA?: number;
  solarV?: number;
  solarA?: number;
  rainRaw?: number;
  scales: Record<string, ScaleReading>;
};

export type CommandStatus = "pending" | "done" | "error";
export type CommandType =
  | "tare"
  | "calibrate"
  | "setTempCoef"
  | "stayAwake"
  | "reload"
  | "update";

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

// Vergleicht Semver-Strings (mit fuehrendem 'v' optional). "dev" gilt als
// aelter -> Updates immer erlaubt. Identisch zur Firmware-Logik.
export function isNewerVersion(local?: string, remote?: string): boolean {
  if (!remote) return false;
  if (!local || local === "dev") return true;
  const parse = (v: string) =>
    v.replace(/^v/i, "").split(/[.\-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [la, lb, lc] = parse(local);
  const [ra, rb, rc] = parse(remote);
  if (ra !== la) return ra > la;
  if (rb !== lb) return rb > lb;
  return rc > lc;
}

// ----- Firestore paths ------------------------------------------------------

export const MAX_SCALES = 8;
export const SCALE_SLOTS = Array.from(
  { length: MAX_SCALES },
  (_, i) => `s${i + 1}`,
);

// ESP32 GPIOs die als HX711-DT (Input) sicher nutzbar sind.
// Reserviert: 0 (Portal-Button), 1/3 (Serial), 4 (HX711 SCK), 6-11 (Flash),
// 12 (Boot-Strap LOW), 23 (OneWire), 32 (VBat).
// HX711 DT braucht nur Digital-Output-faehig. Auf S3: 5-18, 21, 38-42, 47.
// Vermieden: SCK (4), VBat (1), Strapping (0,3,45,46), USB (19,20),
// UART0 (43,44), SPI Flash (26-32), Octal-PSRAM (33-37), LED (48).
export const ALLOWED_DT_PINS = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47,
] as const;

// Default-Pinbelegung pro Slot, identisch zur ESP-Firmware (config.h).
export const DEFAULT_DT_PIN: Record<string, number> = {
  s1: 13, s2: 14, s3: 15, s4: 16,
  s5: 17, s6: 18, s7: 21, s8: 38,
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
  pinOwners: Record<number, string>,
): Promise<string | null> {
  const taken = new Set(existingIds);
  const nextSlot = SCALE_SLOTS.find((s) => !taken.has(s));
  if (!nextSlot) return null;
  const preferred = DEFAULT_DT_PIN[nextSlot];
  const pin =
    preferred && !pinOwners[preferred]
      ? preferred
      : ALLOWED_DT_PINS.find((p) => !pinOwners[p]);
  if (!pin) return null;
  await setDoc(scaleDoc(deviceId, nextSlot), { dtPin: pin });
  return nextSlot;
}

export async function removeScale(
  deviceId: string,
  scaleId: string,
): Promise<void> {
  await deleteDoc(scaleDoc(deviceId, scaleId));
}

// Sammelt alle in der Config belegten GPIO-Pins inkl. System-Pins.
// Pro Pin der Owner-Label fuer die UI-Anzeige ("belegt von …").
export function computePinOwners(
  scales: Record<string, ScaleConfig>,
  scaleIds: string[],
  mainCfg: MainConfig,
): Record<number, string> {
  const map: Record<number, string> = {
    0: "Portal-Button",
    4: "HX711 SCK",
    1: "VBat ADC",
  };
  for (const sid of scaleIds) {
    const pin = scales[sid]?.dtPin ?? DEFAULT_DT_PIN[sid];
    if (typeof pin === "number" && pin > 0 && map[pin] === undefined) {
      map[pin] = sid;
    }
  }
  const sda = mainCfg.i2cSda ?? DEFAULT_I2C_SDA;
  const scl = mainCfg.i2cScl ?? DEFAULT_I2C_SCL;
  if (map[sda] === undefined) map[sda] = "I2C SDA";
  if (map[scl] === undefined) map[scl] = "I2C SCL";
  if (mainCfg.rainEnabled) {
    const rp = mainCfg.rainPin ?? DEFAULT_RAIN_PIN;
    if (map[rp] === undefined) map[rp] = "Regensensor";
  }
  return map;
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
