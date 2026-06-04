"use client";

import { useEffect, useState } from "react";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import { limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import {
  devicesCol,
  globalConfigDoc,
  readingsCol,
  type Device,
  type MainConfig,
  type Reading,
} from "@/lib/devices";
import OnlineDot from "@/components/OnlineDot";
import FirmwareFleet from "@/components/FirmwareFleet";
import SettingsPanel from "@/components/SettingsPanel";
import ScaleDetailModal from "@/components/ScaleDetailModal";

type Tab = "dashboard" | "settings";

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
        <h1 className="mb-6 text-2xl font-semibold">Stockwaage</h1>
        <form onSubmit={handleLogin} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2"
            required
          />
          <input
            type="password"
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2"
            required
          />
          <button
            type="submit"
            className="w-full rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-700"
          >
            Anmelden
          </button>
          {loginError && <p className="text-sm text-red-600">{loginError}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stockwaage</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-neutral-500 sm:inline">{user.email}</span>
          <button
            onClick={() => signOut(auth)}
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
          >
            Logout
          </button>
        </div>
      </header>

      <nav className="mb-4 flex border-b border-neutral-200">
        <TopTab active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
          Dashboard
        </TopTab>
        <TopTab active={tab === "settings"} onClick={() => setTab("settings")}>
          Einstellungen
        </TopTab>
      </nav>

      {tab === "dashboard" &&
        (devices.length === 0 ? (
          <p className="text-neutral-500">
            Noch keine Waage. Starte einen ESP – sobald er sich verbunden hat,
            erscheint er hier.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {devices.map((d) => (
              <li key={d.id}>
                <DeviceTile
                  device={d}
                  latest={latest[d.id]}
                  onClick={() => setSelected(d.id)}
                />
              </li>
            ))}
          </ul>
        ))}

      {tab === "settings" && (
        <div className="space-y-4">
          <SettingsPanel mainCfg={mainCfg} />
          <FirmwareFleet devices={devices} />
        </div>
      )}

      {selected && (
        <ScaleDetailModal
          deviceId={selected}
          mainCfg={mainCfg}
          onClose={() => setSelected(null)}
        />
      )}
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
          ? "border-neutral-900 text-neutral-900"
          : "border-transparent text-neutral-500 hover:text-neutral-900"
      }`}
    >
      {children}
    </button>
  );
}

function DeviceTile({
  device,
  latest,
  onClick,
}: {
  device: Device;
  latest: Reading | null | undefined;
  onClick: () => void;
}) {
  const kg = primaryKg(latest);
  const tempC = latest?.ambientC;
  const vBat = device.vBat ?? latest?.vBat;

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg border border-neutral-200 bg-white p-4 text-left transition hover:border-neutral-400 hover:bg-neutral-50"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{device.id}</span>
        <span className="text-xs text-neutral-500">
          {device.lastSeen ? formatAgo(device.lastSeen) : "—"}
          <OnlineDot lastSeen={device.lastSeen} intervalSec={device.intervalSec} />
        </span>
      </div>

      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
        {kg !== undefined ? `${kg.toFixed(2)} kg` : "—"}
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        <span>{tempC !== undefined ? `${tempC.toFixed(1)} °C` : "– °C"}</span>
        <span>{vBat !== undefined ? `${vBat.toFixed(2)} V` : "– V"}</span>
        {device.intervalSec && <span>Intervall {device.intervalSec}s</span>}
      </div>
    </button>
  );
}

function primaryKg(r: Reading | null | undefined): number | undefined {
  if (!r?.scales) return undefined;
  for (const k of Object.keys(r.scales).sort()) {
    const kg = r.scales[k]?.kg;
    if (typeof kg === "number" && isFinite(kg)) return kg;
  }
  return undefined;
}

function formatAgo(tsMs: number): string {
  const sec = Math.floor((Date.now() - tsMs) / 1000);
  if (sec < 60) return `vor ${sec}s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)}min`;
  if (sec < 86400) return `vor ${Math.floor(sec / 3600)}h`;
  return `vor ${Math.floor(sec / 86400)}d`;
}
