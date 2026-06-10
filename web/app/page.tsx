"use client";

import { useEffect, useRef, useState } from "react";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import { getDocs, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import {
  buildDeviceLabels,
  dailyStatsCol,
  devicesCol,
  globalConfigDoc,
  isHiveDevice,
  readingsCol,
  scaleSlotLabel,
  scalesCol,
  type DailyStat,
  type Device,
  type MainConfig,
  type Reading,
} from "@/lib/devices";
import OnlineDot, { isOnline } from "@/components/OnlineDot";
import HiveLogo from "@/components/HiveLogo";
import FirmwareFleet from "@/components/FirmwareFleet";
import SettingsPanel from "@/components/SettingsPanel";
import ScaleDetailModal from "@/components/ScaleDetailModal";
import HiveDetailModal from "@/components/HiveDetailModal";

type Tab = "dashboard" | "settings";

// Tages-Schlussgewichte (kg je Waage) des letzten abgeschlossenen Tages –
// Referenz fuer den "Δ heute"-Trend auf den Kacheln.
type YesterdayCloses = Record<string, Record<string, number>>;
// Anzeigenamen der Waagen eines Bienenstands (einmalig geladen, kein Listener).
type ScaleNames = Record<string, Record<string, string>>;

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [latest, setLatest] = useState<Record<string, Reading | null>>({});
  const [mainCfg, setMainCfg] = useState<MainConfig>({});
  const [tab, setTab] = useState<Tab>("dashboard");
  const [selected, setSelected] = useState<string | null>(null);
  const [yCloses, setYCloses] = useState<YesterdayCloses>({});
  const [scaleNames, setScaleNames] = useState<ScaleNames>({});
  const extrasLoaded = useRef<Set<string>>(new Set());

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return;
    const unsubs = [
      onSnapshot(devicesCol(), (snap) =>
        setDevices(
          snap.docs.map(
            (d) => ({ id: d.id, ...(d.data() as Omit<Device, "id">) }),
          ),
        ),
      ),
      onSnapshot(globalConfigDoc(), (s) =>
        setMainCfg((s.exists() ? s.data() : {}) as MainConfig),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user]);

  // Letzten Messwert je Gerät live abonnieren (Gewicht/Temp in der Kachel).
  const ids = devices.map((d) => d.id).sort();
  const idsKey = ids.join(",");
  useEffect(() => {
    if (!user || ids.length === 0) return;
    const unsubs = ids.map((id) =>
      onSnapshot(
        query(readingsCol(id), orderBy("ts", "desc"), limit(1)),
        (snap) =>
          setLatest((prev) => ({
            ...prev,
            [id]: (snap.docs[0]?.data() as Reading) ?? null,
          })),
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, idsKey]);

  // Einmalig pro Gerät (kein Listener, schont das Read-Budget):
  // 1) die letzten 2 Tages-Aggregate -> Schlussgewicht von gestern (Δ heute)
  // 2) die Waagen-Namen (fuer die Bienenstand-Kachel)
  useEffect(() => {
    if (!user) return;
    const todayKey = localDayKey(Date.now());
    for (const id of ids) {
      if (extrasLoaded.current.has(id)) continue;
      extrasLoaded.current.add(id);
      getDocs(
        query(dailyStatsCol(id), orderBy("date", "desc"), limit(2)),
      ).then((snap) => {
        const ref = snap.docs
          .map((d) => d.data() as DailyStat)
          .find((s) => s.date < todayKey);
        if (!ref?.scales) return;
        const closes: Record<string, number> = {};
        for (const [sid, agg] of Object.entries(ref.scales)) {
          if (typeof agg?.last === "number" && isFinite(agg.last)) {
            closes[sid] = agg.last;
          }
        }
        setYCloses((prev) => ({ ...prev, [id]: closes }));
      });
      getDocs(scalesCol(id)).then((snap) => {
        const names: Record<string, string> = {};
        for (const d of snap.docs) {
          const n = (d.data() as { name?: string }).name;
          if (n) names[d.id] = n;
        }
        setScaleNames((prev) => ({ ...prev, [id]: names }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, idsKey]);

  const selectedDevice = selected
    ? devices.find((d) => d.id === selected) ?? { id: selected }
    : null;
  // Fallback fuer Altgeraete ohne boardType: Waagen-Zahl aus dem letzten
  // Reading (>1 Waage => Bienenstand/S3).
  const hiveScaleCount = selected
    ? Object.keys(latest[selected]?.scales ?? {}).length
    : 0;

  // Eindeutige Anzeigenamen je Geraet (eigener Name oder Default mit Nummer).
  const scaleCounts: Record<string, number> = {};
  for (const d of devices) {
    scaleCounts[d.id] = Object.keys(latest[d.id]?.scales ?? {}).length;
  }
  const labels = buildDeviceLabels(devices, scaleCounts);

  // Ein S3-Bienenstand braucht den (gemeinsamen) BMP280 fuer die Temperatur-
  // Kompensation aller Waagen. Ist er global deaktiviert, ist kein gescheites
  // Wiegen moeglich -> Warnung, sobald ueberhaupt ein S3 vorhanden ist.
  const anyHive = devices.some((d) => labels[d.id]?.isHive);
  const tempSensorMissing = anyHive && mainCfg.bme280Enabled !== true;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Login fehlgeschlagen");
    }
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-3xl">
              🐝
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Stockwaage</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Bienenstock-Monitoring
            </p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-amber-400 focus:outline-none"
              required
            />
            <input
              type="password"
              placeholder="Passwort"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-amber-400 focus:outline-none"
              required
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-amber-500 px-3 py-2 font-medium text-white transition hover:bg-amber-600"
            >
              Anmelden
            </button>
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-xl">
            🐝
          </div>
          <h1 className="text-xl font-bold tracking-tight">Stockwaage</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-neutral-400 sm:inline">{user.email}</span>
          <button
            onClick={() => signOut(auth)}
            className="rounded-lg border border-neutral-300 px-2.5 py-1 text-neutral-600 hover:bg-white"
          >
            Logout
          </button>
        </div>
      </header>

      <nav className="mb-5 flex border-b border-neutral-200">
        <TopTab active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
          Dashboard
        </TopTab>
        <TopTab active={tab === "settings"} onClick={() => setTab("settings")}>
          Einstellungen
        </TopTab>
      </nav>

      {tab === "dashboard" &&
        (devices.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-neutral-300 bg-white/60 px-6 py-16 text-center">
            <span className="mb-3 text-4xl">🐝</span>
            <p className="font-medium text-neutral-700">Noch keine Waage</p>
            <p className="mt-1 max-w-xs text-sm text-neutral-500">
              Starte einen ESP – sobald er sich verbunden hat, erscheint er
              hier automatisch.
            </p>
          </div>
        ) : (
          <>
            <SummaryStrip devices={devices} latest={latest} />

            {tempSensorMissing && (
              <button
                type="button"
                onClick={() => setTab("settings")}
                className="mb-3 block w-full rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900 hover:bg-amber-100"
              >
                <span className="font-semibold">
                  ⚠️ Temperatursensor (BMP280) ist deaktiviert
                </span>
                <span className="mt-0.5 block text-xs text-amber-800">
                  Der Bienenstand misst die Temperatur für alle Waagen über
                  einen gemeinsamen BMP280. Ohne ihn ist keine
                  Temperatur-Kompensation und damit kein zuverlässiges Wiegen
                  möglich. Jetzt unter Einstellungen aktivieren.
                </span>
              </button>
            )}

            <ul className="grid items-start gap-3 sm:grid-cols-2">
              {devices.map((d) => {
                const lbl = labels[d.id];
                return (
                  <li key={d.id}>
                    {lbl?.isHive ? (
                      <HiveTile
                        device={d}
                        label={lbl.label}
                        latest={latest[d.id]}
                        yCloses={yCloses[d.id]}
                        names={scaleNames[d.id]}
                        onClick={() => setSelected(d.id)}
                      />
                    ) : (
                      <ScaleTile
                        device={d}
                        label={lbl?.label ?? d.id}
                        latest={latest[d.id]}
                        yCloses={yCloses[d.id]}
                        onClick={() => setSelected(d.id)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ))}

      {tab === "settings" && (
        <div className="space-y-4">
          <SettingsPanel mainCfg={mainCfg} />
          <FirmwareFleet devices={devices} />
        </div>
      )}

      {selectedDevice &&
        (isHiveDevice(selectedDevice, hiveScaleCount) ? (
          <HiveDetailModal
            deviceId={selectedDevice.id}
            defaultName={labels[selectedDevice.id]?.default ?? "Bienenstand"}
            mainCfg={mainCfg}
            onClose={() => setSelected(null)}
          />
        ) : (
          <ScaleDetailModal
            deviceId={selectedDevice.id}
            defaultName={labels[selectedDevice.id]?.default ?? "Waage"}
            mainCfg={mainCfg}
            onClose={() => setSelected(null)}
          />
        ))}
    </main>
  );
}

function TopTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-amber-500 text-neutral-900"
          : "border-transparent text-neutral-500 hover:text-neutral-900"
      }`}
    >
      {children}
    </button>
  );
}

// Kompakte Kennzahlen ueber den Kacheln: Geraete, online, Gesamtgewicht.
function SummaryStrip({
  devices,
  latest,
}: {
  devices: Device[];
  latest: Record<string, Reading | null>;
}) {
  const online = devices.filter((d) =>
    isOnline(d.lastSeen, d.intervalSec),
  ).length;
  let scaleCount = 0;
  let sum = 0;
  let anyKg = false;
  for (const d of devices) {
    const scales = latest[d.id]?.scales ?? {};
    for (const s of Object.values(scales)) {
      scaleCount++;
      if (typeof s?.kg === "number" && isFinite(s.kg)) {
        sum += s.kg;
        anyKg = true;
      }
    }
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
      <span>
        <span className="font-semibold text-neutral-700">{devices.length}</span>{" "}
        {devices.length === 1 ? "Gerät" : "Geräte"}
      </span>
      <span>
        <span
          className={`font-semibold ${
            online === devices.length ? "text-green-600" : "text-amber-600"
          }`}
        >
          {online}/{devices.length}
        </span>{" "}
        online
      </span>
      <span>
        <span className="font-semibold text-neutral-700">{scaleCount}</span>{" "}
        {scaleCount === 1 ? "Waage" : "Waagen"}
      </span>
      {anyKg && (
        <span className="ml-auto font-mono tabular-nums">
          Σ{" "}
          <span className="font-semibold text-neutral-700">
            {sum.toFixed(1)} kg
          </span>
        </span>
      )}
    </div>
  );
}

// ---- Kacheln ----------------------------------------------------------------

const tileClass =
  "block w-full rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:border-amber-300 hover:shadow-md";

// Gemeinsamer Kachel-Kopf: Logo + Name + Typ-Badge + Geraete-ID + Online-Dot.
function TileHeader({
  device,
  label,
  variant,
  subtitle,
}: {
  device: Device;
  label: string;
  variant: "single" | "multi";
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
          variant === "multi" ? "bg-amber-100" : "bg-amber-50"
        }`}
      >
        <HiveLogo variant={variant} className="h-9 w-9" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">{label}</span>
          <span className="shrink-0 text-xs text-neutral-400">
            {device.lastSeen ? formatAgo(device.lastSeen) : "—"}
            <OnlineDot
              lastSeen={device.lastSeen}
              intervalSec={device.intervalSec}
            />
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${
              variant === "multi"
                ? "bg-amber-100 text-amber-700"
                : "bg-stone-200 text-stone-600"
            }`}
          >
            {subtitle}
          </span>
          <span className="font-mono text-[10px] text-neutral-400">
            {device.id}
          </span>
        </div>
      </div>
    </div>
  );
}

// C5: eine Waage = eine Kachel.
function ScaleTile({
  device,
  label,
  latest,
  yCloses,
  onClick,
}: {
  device: Device;
  label: string;
  latest: Reading | null | undefined;
  yCloses?: Record<string, number>;
  onClick: () => void;
}) {
  const sid = primarySid(latest);
  const kg = sid ? latest?.scales?.[sid]?.kg : undefined;
  const delta = deltaFor(kg, sid ? yCloses?.[sid] : undefined);

  return (
    <button type="button" onClick={onClick} className={tileClass}>
      <TileHeader
        device={device}
        label={label}
        variant="single"
        subtitle="Einzelwaage · C5"
      />
      <WeightHero kg={kg} delta={delta} />
      <TileFooter device={device} latest={latest} />
    </button>
  );
}

// S3: Bienenstand = eine Kachel mit allen Waagen.
function HiveTile({
  device,
  label,
  latest,
  yCloses,
  names,
  onClick,
}: {
  device: Device;
  label: string;
  latest: Reading | null | undefined;
  yCloses?: Record<string, number>;
  names?: Record<string, string>;
  onClick: () => void;
}) {
  const sids = Object.keys(latest?.scales ?? {}).sort();
  let sum = 0;
  let anySum = false;
  let dSum = 0;
  let anyDelta = false;
  for (const sid of sids) {
    const kg = latest?.scales?.[sid]?.kg;
    if (typeof kg !== "number" || !isFinite(kg)) continue;
    sum += kg;
    anySum = true;
    const prev = yCloses?.[sid];
    if (typeof prev === "number") {
      dSum += kg - prev;
      anyDelta = true;
    }
  }

  return (
    <button type="button" onClick={onClick} className={tileClass}>
      <TileHeader
        device={device}
        label={label}
        variant="multi"
        subtitle={`Bienenstand · S3 · ${sids.length} ${
          sids.length === 1 ? "Waage" : "Waagen"
        }`}
      />

      <WeightHero
        kg={anySum ? sum : undefined}
        delta={anyDelta ? dSum : null}
        suffix="gesamt"
      />

      {sids.length > 0 && (
        <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-100 bg-neutral-50/60 px-2.5 py-1">
          {sids.map((sid) => {
            const kg = latest?.scales?.[sid]?.kg;
            const d = deltaFor(kg, yCloses?.[sid]);
            return (
              <li
                key={sid}
                className="flex items-baseline justify-between gap-2 py-1 text-sm"
              >
                <span className="truncate text-neutral-600">
                  {names?.[sid] || scaleSlotLabel(sid)}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {d !== null && (
                    <span
                      className={`text-[11px] font-medium tabular-nums ${
                        d >= 0 ? "text-green-600" : "text-red-500"
                      }`}
                    >
                      {d >= 0 ? "+" : ""}
                      {d.toFixed(1)}
                    </span>
                  )}
                  <span className="font-mono font-medium tabular-nums">
                    {typeof kg === "number" && isFinite(kg)
                      ? `${kg.toFixed(1)} kg`
                      : "—"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <TileFooter device={device} latest={latest} />
    </button>
  );
}

function WeightHero({
  kg,
  delta,
  suffix,
}: {
  kg?: number;
  delta: number | null;
  suffix?: string;
}) {
  const hasKg = typeof kg === "number" && isFinite(kg);
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-3xl font-bold tabular-nums">
        {hasKg ? kg!.toFixed(2) : "—"}
        {hasKg && (
          <span className="ml-1 text-base font-medium text-neutral-400">
            kg{suffix ? ` ${suffix}` : ""}
          </span>
        )}
      </span>
      {delta !== null && (
        <span
          className={`text-sm font-semibold tabular-nums ${
            delta >= 0 ? "text-green-600" : "text-red-500"
          }`}
          title="Veränderung seit dem letzten Tagesabschluss"
        >
          {delta >= 0 ? "▲" : "▼"} {delta >= 0 ? "+" : ""}
          {delta.toFixed(2)} heute
        </span>
      )}
    </div>
  );
}

function TileFooter({
  device,
  latest,
}: {
  device: Device;
  latest: Reading | null | undefined;
}) {
  const tempC = latest?.ambientC;
  const vBat = device.vBat ?? latest?.vBat ?? latest?.batteryV;
  const solarV = latest?.solarV;
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-neutral-100 pt-2 text-xs text-neutral-500">
      <span title="Temperatur">
        🌡 {tempC !== undefined ? `${tempC.toFixed(1)} °C` : "—"}
      </span>
      <span title="Akku">
        🔋 {vBat !== undefined ? `${vBat.toFixed(2)} V` : "—"}
      </span>
      {solarV !== undefined && (
        <span title="Solar">☀️ {solarV.toFixed(1)} V</span>
      )}
      {device.intervalSec && (
        <span className="ml-auto" title="Mess-Intervall">
          ⏱ {formatInterval(device.intervalSec)}
        </span>
      )}
    </div>
  );
}

// ---- Helpers ------------------------------------------------------------------

function primarySid(r: Reading | null | undefined): string | undefined {
  if (!r?.scales) return undefined;
  return Object.keys(r.scales).sort()[0];
}

function deltaFor(kg?: number, prev?: number): number | null {
  if (typeof kg !== "number" || !isFinite(kg)) return null;
  if (typeof prev !== "number" || !isFinite(prev)) return null;
  return kg - prev;
}

function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatInterval(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec >= 60) return `${Math.round(sec / 60)}min`;
  return `${sec}s`;
}

function formatAgo(tsMs: number): string {
  const sec = Math.floor((Date.now() - tsMs) / 1000);
  if (sec < 60) return `vor ${sec}s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)}min`;
  if (sec < 86400) return `vor ${Math.floor(sec / 3600)}h`;
  return `vor ${Math.floor(sec / 86400)}d`;
}
