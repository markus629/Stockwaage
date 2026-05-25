"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import { onSnapshot } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { devicesCol, type Device } from "@/lib/devices";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(devicesCol(), (snap) => {
      setDevices(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Device, "id">) })),
      );
    });
  }, [user]);

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

      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-neutral-500">
        Geräte
      </h2>
      {devices.length === 0 ? (
        <p className="text-neutral-500">
          Noch keine Geräte. Starte den ESP, sobald er sich verbunden hat,
          erscheint er hier.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {devices.map((d) => (
            <li key={d.id}>
              <Link
                href={`/devices/${d.id}`}
                className="block rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-neutral-400"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{d.id}</span>
                  <span className="text-xs text-neutral-500">
                    {d.lastSeen ? formatAgo(d.lastSeen) : "—"}
                  </span>
                </div>
                <div className="mt-1 flex gap-4 text-xs text-neutral-500">
                  {d.vBat !== undefined && <span>Akku {d.vBat.toFixed(2)} V</span>}
                  {d.intervalSec && <span>Intervall {d.intervalSec}s</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function formatAgo(tsMs: number): string {
  const sec = Math.floor((Date.now() - tsMs) / 1000);
  if (sec < 60) return `vor ${sec}s`;
  if (sec < 3600) return `vor ${Math.floor(sec / 60)}min`;
  if (sec < 86400) return `vor ${Math.floor(sec / 3600)}h`;
  return `vor ${Math.floor(sec / 86400)}d`;
}
