"use client";

import { useEffect, useState } from "react";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit,
} from "firebase/firestore";
import { auth, db, ownerUid } from "@/lib/firebase";

type Reading = {
  ts: number;
  scales: Record<string, number>;
  temps: Record<string, number>;
};

type Device = {
  id: string;
  deviceId?: string;
  lastSeen?: number;
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [latest, setLatest] = useState<Reading | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user || !ownerUid) return;
    const q = collection(db, "users", ownerUid, "devices");
    return onSnapshot(q, (snap) => {
      const list: Device[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Device, "id">),
      }));
      setDevices(list);
      if (!selectedDevice && list.length > 0) {
        setSelectedDevice(list[0]!.id);
      }
    });
  }, [user, selectedDevice]);

  useEffect(() => {
    if (!user || !ownerUid || !selectedDevice) return;
    const q = query(
      collection(db, "users", ownerUid, "devices", selectedDevice, "readings"),
      orderBy("ts", "desc"),
      limit(1),
    );
    return onSnapshot(q, (snap) => {
      const d = snap.docs[0];
      setLatest(d ? (d.data() as Reading) : null);
    });
  }, [user, selectedDevice]);

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
          {loginError && (
            <p className="text-sm text-red-600">{loginError}</p>
          )}
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stockwaage</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-500">{user.email}</span>
          <button
            onClick={() => signOut(auth)}
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
          >
            Logout
          </button>
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
          Geräte
        </h2>
        {devices.length === 0 ? (
          <p className="text-neutral-500">
            Noch keine Geräte. Starte den Pi-Service.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDevice(d.id)}
                className={`rounded border px-3 py-1 text-sm ${
                  selectedDevice === d.id
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 hover:bg-neutral-100"
                }`}
              >
                {d.id}
                {d.lastSeen && (
                  <span className="ml-2 text-xs opacity-70">
                    {formatAgo(d.lastSeen)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedDevice && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Letzte Messung
          </h2>
          {!latest ? (
            <p className="text-neutral-500">Noch keine Messwerte.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Waagen (Rohwert)" data={latest.scales} unit="" digits={0} />
              <Card title="Temperaturen" data={latest.temps} unit="°C" digits={2} />
            </div>
          )}
          {latest && (
            <p className="mt-3 text-xs text-neutral-500">
              {new Date(latest.ts).toLocaleString("de-DE")}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function Card({
  title,
  data,
  unit,
  digits = 2,
}: {
  title: string;
  data: Record<string, number>;
  unit: string;
  digits?: number;
}) {
  const entries = Object.entries(data);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-medium text-neutral-600">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-neutral-400">keine</p>
      ) : (
        <ul className="space-y-1">
          {entries.map(([k, v]) => (
            <li key={k} className="flex justify-between font-mono text-sm">
              <span className="text-neutral-500">{k}</span>
              <span>
                {v.toFixed(digits)}
                {unit ? ` ${unit}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatAgo(tsMs: number): string {
  const sec = Math.floor((Date.now() - tsMs) / 1000);
  if (sec < 60) return `vor ${sec}s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)}min`;
  return `vor ${Math.floor(sec / 3600)}h`;
}
