"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { globalConfigDoc, type MainConfig } from "@/lib/devices";
import SettingsPanel from "@/components/SettingsPanel";

export default function GlobalSettingsPage() {
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [mainCfg, setMainCfg] = useState<MainConfig>({});

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user || user === "loading") return;
    return onSnapshot(globalConfigDoc(), (s) =>
      setMainCfg((s.exists() ? s.data() : {}) as MainConfig),
    );
  }, [user]);

  if (user === "loading") return <div className="p-6">Laden…</div>;
  if (!user)
    return (
      <div className="p-6">
        <Link className="text-blue-600 underline" href="/">
          Bitte einloggen
        </Link>
      </div>
    );

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Übersicht
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Globale Einstellungen</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Gelten für alle ESPs. Die Kalibrierung machst du pro Waage auf deren
          Detailseite.
        </p>
      </header>

      <SettingsPanel mainCfg={mainCfg} />
    </main>
  );
}
