import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { db, ownerUid } from "./firebase";

// ----- Types ----------------------------------------------------------------

export type Device = {
  id: string;
  deviceId?: string;
  // Vom Imker vergebener Anzeigename (z.B. "Bienenstand 01"). Leer -> Default
  // aus Typ + laufender Nummer (siehe deviceLabel im Dashboard).
  name?: string;
  lastSeen?: number;
  vBat?: number;
  intervalSec?: number;
  firmwareVersion?: string;
  latestFirmwareVersion?: string;
  latestFirmwareUrl?: string;
  // Variante: "s3" = Bienenstand (mehrere Waagen), "c5" = eine Waage.
  boardType?: string;
  maxScales?: number;
};

// Globales Config-Dokument (users/{uid}/config/main) – gilt fuer ALLE ESPs
// (S3 wie C5). Die Hardware-Felder (Pins/Sensoren) gelten fuer alle S3
// gemeinsam (alle gleich aufgebaut); die C5 ignoriert sie.
export type MainConfig = {
  intervalSec?: number;
  stayAwakeUntilMs?: number;
  // false = ESP bleibt wach (kein Deep Sleep).
  deepSleepEnabled?: boolean;
  autoUpdateEnabled?: boolean;
  // Futter-Tracker: Tagesaenderungen > diesem Wert gelten als Eingriff.
  feedStepThresholdKg?: number;
  // ---- S3-Bienenstand: Hardware (pro Geraet konfigurierbar) ----
  // Gemeinsamer HX711-Clock-Pin (alle Waagen teilen sich SCK). Default 4.
  sckPin?: number;
  // I2C-Bus (geteilt von BMP280 + INA219)
  i2cSda?: number;
  i2cScl?: number;
  // BMP280 (Temp/Druck) – Feldname historisch "bme280*"
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
  // Wake-Button weckt den ESP aus Deep-Sleep ueber einen externen Taster.
  // wakeButtonLevel 0 -> Taster nach GND, 1 -> nach 3.3V.
  wakeButtonEnabled?: boolean;
  wakeButtonPin?: number;
  wakeButtonLevel?: number;
  wakePauseMin?: number;
};

export type ScaleConfig = {
  id: string; // "s1".."s8"
  name?: string;
  // S3-Bienenstand: Waage aktiv + individueller HX711-DT-Pin.
  enabled?: boolean;
  dtPin?: number;
  offset?: number;
  scaleFactor?: number;
  tempCoef?: number;
  tempRefC?: number;
  // Futter-Tracker: "Baseline" = aktuelles Gewicht beim Knopfdruck (= 0 Futter).
  // Restmenge = aktuelles Gewicht − Baseline; Verbrauch ab feedBaselineAt.
  feedBaselineKg?: number;
  feedBaselineAt?: number; // ms
  feedBaselineVisible?: boolean; // Baseline-Linie im Graph zeigen
  learning?: { startedAt: number };
};

export type ScaleReading = { raw: number; kg?: number };

export type Reading = {
  ts: number;
  vBat?: number;
  ambientC?: number;
  // Nur S3-Bienenstand (BMP280 / INA219 x2 / Regensensor).
  ambientPressure?: number;
  batteryV?: number;
  batteryA?: number;
  solarV?: number;
  solarA?: number;
  rainRaw?: number;
  scales: Record<string, ScaleReading>;
};

// Aggregat einer Metrik (Waage oder Sensor) ueber einen Tag.
export type MetricAgg = {
  sum: number;
  count: number;
  min: number;
  max: number;
  last: number;
};

// Ein Tages-Aggregat-Dokument (dailyStats/{YYYY-MM-DD}).
export type DailyStat = {
  date: string; // "YYYY-MM-DD"
  scales: Record<string, MetricAgg>;
  tempC?: MetricAgg;
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

// Imker-Logbuch-Eintrag zu einer Waage (z.B. "Honig entnommen").
export type Comment = {
  id: string;
  scaleId: string;
  text: string;
  ts: number; // Ereignis-Zeitpunkt, erscheint als Marker im Langzeit-Graph
  createdAt: number;
};

// Download-URL der App-Binary eines Releases, passend zur Variante des Geraets.
// CI nennt die Assets "stockwaage-<boardType>-<tag>.bin" (s3 / c5). Wird im
// Update-Befehl mitgeschickt, damit der ESP gezielt die richtige App laedt.
export const firmwareBinUrl = (version: string, boardType: string) =>
  `https://github.com/markus629/Stockwaage/releases/download/${version}/stockwaage-${boardType}-${version}.bin`;

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

export const devicePath = (deviceId: string) =>
  ["users", ownerUid, "devices", deviceId] as const;

export const devicesCol = () => collection(db, "users", ownerUid, "devices");
export const deviceDoc = (id: string) => doc(db, ...devicePath(id));
// GLOBALE Config fuer ALLE ESPs (S3 wie C5): users/{uid}/config/main. Enthaelt
// Verhalten + die (fuer alle S3 gleiche) Hardware/Sensor-Konfiguration.
export const globalConfigDoc = () =>
  doc(db, "users", ownerUid, "config", "main");
export const scaleDoc = (id: string, scaleId: string) =>
  doc(db, ...devicePath(id), "scales", scaleId);
export const scalesCol = (id: string) =>
  collection(db, ...devicePath(id), "scales");
export const readingsCol = (id: string) =>
  collection(db, ...devicePath(id), "readings");
// Einzelnes, vom ESP im Wachbetrieb alle ~5s ueberschriebenes Live-Dokument.
export const liveDoc = (id: string) =>
  doc(db, ...devicePath(id), "live", "current");
export const commandsCol = (id: string) =>
  collection(db, ...devicePath(id), "commands");
export const dailyStatsCol = (id: string) =>
  collection(db, ...devicePath(id), "dailyStats");
export const commentsCol = (id: string) =>
  collection(db, ...devicePath(id), "comments");
export const commentDoc = (id: string, commentId: string) =>
  doc(db, ...devicePath(id), "comments", commentId);

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

// Setzt die Futter-Baseline aufs aktuelle Waagengewicht (= 0 Futter). Restmenge
// ergibt sich danach automatisch aus aktuell − Baseline.
export async function setFeedBaseline(
  deviceId: string,
  scaleId: string,
  currentKg: number,
): Promise<void> {
  await updateScaleConfig(deviceId, scaleId, {
    feedBaselineKg: Math.round(currentKg * 100) / 100,
    feedBaselineAt: Date.now(),
    feedBaselineVisible: true,
  });
}

export async function clearFeedTracking(
  deviceId: string,
  scaleId: string,
): Promise<void> {
  await updateDoc(scaleDoc(deviceId, scaleId), {
    feedBaselineKg: deleteField(),
    feedBaselineAt: deleteField(),
    feedBaselineVisible: deleteField(),
  });
}

// Globale Einstellungen fuer alle ESPs (Verhalten + S3-Hardware/Sensoren).
export async function updateGlobalConfig(
  patch: Partial<MainConfig>,
): Promise<void> {
  await setDoc(globalConfigDoc(), patch, { merge: true });
}

// ----- S3-Bienenstand: Geraete-Typ + Pin-Belegung ---------------------------

// Variante erkennen: neue Firmware meldet boardType/maxScales im Heartbeat.
// Fallback fuer Altgeraete ohne Meldung: > 1 angelegte Waage = Bienenstand.
export function isHiveDevice(d: Device, scaleCount = 0): boolean {
  if (d.boardType === "s3") return true;
  if (d.boardType === "c5") return false;
  if (typeof d.maxScales === "number") return d.maxScales > 1;
  return scaleCount > 1;
}

// Schreibt Geraete-Felder (z.B. den Anzeigenamen) ins Device-Dokument.
export async function updateDevice(
  deviceId: string,
  patch: Partial<Pick<Device, "name">>,
): Promise<void> {
  await setDoc(deviceDoc(deviceId), patch, { merge: true });
}

// Eindeutige, stabile Anzeigenamen pro Geraet: eigener Name, sonst Default aus
// Typ + laufender Nummer je Typ (Bienenstand 01 / Waage 01). Die Nummerierung
// folgt der sortierten Geraete-ID, ist also unabhaengig von der Datenlage
// stabil. scaleCounts liefert pro Geraet die Anzahl Waagen (fuer den Typ-
// Fallback bei Altgeraeten ohne boardType).
export function buildDeviceLabels(
  devices: Device[],
  scaleCounts: Record<string, number> = {},
): Record<string, { label: string; default: string; isHive: boolean }> {
  const sorted = [...devices].sort((a, b) => a.id.localeCompare(b.id));
  let hiveN = 0;
  let scaleN = 0;
  const out: Record<
    string,
    { label: string; default: string; isHive: boolean }
  > = {};
  for (const d of sorted) {
    const hive = isHiveDevice(d, scaleCounts[d.id] ?? 0);
    const n = hive ? ++hiveN : ++scaleN;
    const def = `${hive ? "Bienenstand" : "Waage"} ${String(n).padStart(2, "0")}`;
    out[d.id] = {
      default: def,
      label: d.name?.trim() || def,
      isHive: hive,
    };
  }
  return out;
}

// Default-Name einer einzelnen Waage innerhalb eines Bienenstands ("Waage 01").
export function scaleSlotLabel(scaleId: string): string {
  const n = parseInt(scaleId.replace(/^s/, ""), 10);
  return Number.isFinite(n) ? `Waage ${String(n).padStart(2, "0")}` : scaleId;
}

export const MAX_SCALES = 8;
export const SCALE_SLOTS = Array.from(
  { length: MAX_SCALES },
  (_, i) => `s${i + 1}`,
);

// Sichere GPIOs auf dem ESP32-S3-WROOM-1 N16R8. Vermieden: VBat (1),
// Strapping (0,3,45,46), USB (19,20), UART0 (43,44), SPI-Flash (26-32),
// Octal-PSRAM (33-37), LED (48). GPIO 4 ist dabei (SCK ist konfigurierbar).
export const ALLOWED_DT_PINS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42,
  47,
] as const;
export const DEFAULT_HX711_SCK = 4;
export const ALLOWED_SCK_PINS: readonly number[] = ALLOWED_DT_PINS;
// Default-Pinbelegung pro Slot, identisch zur S3-Firmware (config.h).
export const DEFAULT_DT_PIN: Record<string, number> = {
  s1: 13, s2: 14, s3: 15, s4: 16, s5: 17, s6: 18, s7: 21, s8: 38,
};
export const DEFAULT_I2C_SDA = 8;
export const DEFAULT_I2C_SCL = 9;
export const ALLOWED_I2C_PINS = [
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47,
] as const;
export const BME280_ADDRS = [0x76, 0x77] as const;
export const INA219_ADDRS = [0x40, 0x41, 0x44, 0x45] as const;
export const ALLOWED_RAIN_PINS = [2, 5, 6, 7, 8, 9, 10] as const;
export const DEFAULT_RAIN_PIN = 2;
export const ALLOWED_WAKE_PINS = [
  5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21,
] as const;
export const DEFAULT_WAKE_PIN = 5;
export const DEFAULT_BME280_ADDR = 0x76;
export const DEFAULT_INA_BATTERY_ADDR = 0x40;
export const DEFAULT_INA_SOLAR_ADDR = 0x41;

// Naechsten freien Slot anlegen (mit freiem DT-Pin) -> Slot-Id oder null.
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
  await setDoc(scaleDoc(deviceId, nextSlot), { enabled: true, dtPin: pin });
  return nextSlot;
}

// Sammelt alle in der Config belegten GPIO-Pins inkl. System-Pins. Pro Pin der
// Owner-Label fuer die UI-Anzeige ("belegt von …").
export function computePinOwners(
  scales: Record<string, ScaleConfig>,
  scaleIds: string[],
  mainCfg: MainConfig,
): Record<number, string> {
  const map: Record<number, string> = { 0: "Portal-Button", 1: "VBat ADC" };
  const sck = mainCfg.sckPin ?? DEFAULT_HX711_SCK;
  if (typeof sck === "number" && sck > 0 && map[sck] === undefined) {
    map[sck] = "HX711 SCK";
  }
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
  if (mainCfg.wakeButtonEnabled) {
    const wp = mainCfg.wakeButtonPin ?? DEFAULT_WAKE_PIN;
    if (map[wp] === undefined) map[wp] = "Wake-Button";
  }
  return map;
}

// Firestore-Batch-Limit ist 500 Ops; etwas Reserve lassen.
const BATCH_SIZE = 450;

// Obergrenze fuer das Bereinigen von Rohmesswerten beim Loeschen einer Waage.
// Schuetzt das (kostenlose) Tages-Read-Budget vor einer Riesen-Collection.
// Aeltere Readings raeumt ohnehin die Firestore-TTL weg (expireAt), und ein
// verwaistes scales.<sid>-Feld in alten Docs ist unsichtbar (die Waage ist
// aus der Config raus). 10000 = Firestore-Maximum fuer limit(); deckt bei
// 15-min-Intervall ~100 Tage ab (mehr als die TTL).
const MAX_READING_CLEANUP = 10000;

async function deleteRefsInBatches(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + BATCH_SIZE)) batch.delete(ref);
    await batch.commit();
  }
}

async function dropScaleFieldInBatches(
  refs: DocumentReference[],
  scaleId: string,
): Promise<void> {
  const patch = { [`scales.${scaleId}`]: deleteField() };
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + BATCH_SIZE)) batch.update(ref, patch);
    await batch.commit();
  }
}

// Loescht eine Waage vollstaendig: Konfiguration, alle Kommentare und das
// scales.<sid>-Feld aus saemtlichen readings + dailyStats. Unwiderruflich.
export async function removeScale(
  deviceId: string,
  scaleId: string,
): Promise<void> {
  // 1) Kommentare dieser Waage (eigene Dokumente).
  const cs = await getDocs(
    query(commentsCol(deviceId), where("scaleId", "==", scaleId)),
  );
  await deleteRefsInBatches(cs.docs.map((d) => d.ref));

  // 2) scales.<sid> aus den (neuesten) readings entfernen (geteilte
  //    Dokumente). Hart begrenzt, damit das Read-Budget nicht explodiert;
  //    aeltere Readings verschwinden per TTL.
  const rs = await getDocs(
    query(readingsCol(deviceId), orderBy("ts", "desc"), limit(MAX_READING_CLEANUP)),
  );
  await dropScaleFieldInBatches(
    rs.docs.map((d) => d.ref),
    scaleId,
  );

  // 3) scales.<sid> aus allen Tages-Aggregaten entfernen.
  const ds = await getDocs(dailyStatsCol(deviceId));
  await dropScaleFieldInBatches(
    ds.docs.map((d) => d.ref),
    scaleId,
  );

  // 4) Konfigurations-Dokument der Waage.
  await deleteDoc(scaleDoc(deviceId, scaleId));
}

export async function addComment(
  deviceId: string,
  scaleId: string,
  text: string,
  ts: number = Date.now(),
): Promise<void> {
  await addDoc(commentsCol(deviceId), {
    scaleId,
    text,
    ts,
    createdAt: Date.now(),
  });
}

export async function updateComment(
  deviceId: string,
  commentId: string,
  text: string,
): Promise<void> {
  await updateDoc(commentDoc(deviceId, commentId), { text });
}

export async function deleteComment(
  deviceId: string,
  commentId: string,
): Promise<void> {
  await deleteDoc(commentDoc(deviceId, commentId));
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
