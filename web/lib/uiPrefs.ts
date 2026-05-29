"use client";

import { useCallback, useEffect, useState } from "react";

export type DeviceTab = "dashboard" | "scales" | "settings";

const DEVICE_TAB_KEY_PREFIX = "stockwaage.tab.";

export function useDeviceTab(
  deviceId: string,
): [DeviceTab, (t: DeviceTab) => void] {
  const [tab, setTab] = useState<DeviceTab>("dashboard");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!deviceId || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DEVICE_TAB_KEY_PREFIX + deviceId);
      if (raw === "dashboard" || raw === "scales" || raw === "settings")
        setTab(raw as DeviceTab);
    } catch {}
    setHydrated(true);
  }, [deviceId]);

  useEffect(() => {
    if (!hydrated || !deviceId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DEVICE_TAB_KEY_PREFIX + deviceId, tab);
    } catch {}
  }, [hydrated, deviceId, tab]);

  return [tab, setTab];
}

export type ConfigTab = "calib" | "temp" | "pin";

export type ScaleUiPrefs = {
  cardOpen: boolean;
  configOpen: boolean;
  configTab: ConfigTab;
  stackDays: number; // 24h-Stapel: Anzahl uebereinandergelegter Tage
};

// Stufen fuer den 24h-Stapel-Stepper.
export const STACK_DAY_STEPS = [1, 2, 3, 5, 7, 10, 14, 21] as const;

export const DEFAULT_SCALE_PREFS: ScaleUiPrefs = {
  cardOpen: true,
  configOpen: false,
  configTab: "calib",
  stackDays: 7,
};

type AllPrefs = Record<string, ScaleUiPrefs>;

const KEY_PREFIX = "stockwaage.collapse.";

export function useScaleUiPrefs(deviceId: string) {
  const [state, setState] = useState<AllPrefs>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!deviceId || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(KEY_PREFIX + deviceId);
      if (raw) setState(JSON.parse(raw) as AllPrefs);
    } catch {}
    setHydrated(true);
  }, [deviceId]);

  useEffect(() => {
    if (!hydrated || !deviceId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        KEY_PREFIX + deviceId,
        JSON.stringify(state),
      );
    } catch {}
  }, [hydrated, deviceId, state]);

  const get = useCallback(
    (scaleId: string): ScaleUiPrefs =>
      state[scaleId] ?? DEFAULT_SCALE_PREFS,
    [state],
  );

  const set = useCallback(
    (scaleId: string, patch: Partial<ScaleUiPrefs>) => {
      setState((prev) => ({
        ...prev,
        [scaleId]: { ...(prev[scaleId] ?? DEFAULT_SCALE_PREFS), ...patch },
      }));
    },
    [],
  );

  return { get, set };
}
