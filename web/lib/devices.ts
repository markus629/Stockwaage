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
  lastSeen?: number;
  vBat?: number;
  intervalSec?: number;
  firmwareVersion?: string;
  latestFirmwareVersion?: string;
  latestFirmwareUrl?: string;
};

// Globale Einstellungen (gelten fuer alle ESPs).
export type MainConfig = {
  intervalSec?: number;
  stayAwakeUntilMs?: number;
  // false = ESP bleibt wach (kein Deep Sleep).
  deepSleepEnabled?: boolean;
  autoUpdateEnabled?: boolean;
  // Futter-Tracker: Tagesaenderungen > diesem Wert gelten als Eingriff.
  feedStepThresholdKg?: number;
};

export type ScaleConfig = {
  id: string; // "s1"
  name?: string;
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

// Download-URL der App-Binary eines Releases. Deterministisch aus der Version
// (CI nennt das Asset immer "stockwaage-<tag>.bin"). Wird im Update-Befehl
// mitgeschickt, damit der ESP gezielt die App laedt (nicht bootloader.bin).
export const firmwareBinUrl = (version: string) =>
  `https://github.com/markus629/Stockwaage/releases/download/${version}/stockwaage-${version}.bin`;

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
// GLOBALE Config (gilt fuer alle ESPs): users/{uid}/config/main.
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

// Globale Einstellungen fuer alle ESPs.
export async function updateGlobalConfig(
  patch: Partial<MainConfig>,
): Promise<void> {
  await setDoc(globalConfigDoc(), patch, { merge: true });
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
