"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string | number;
  onCommit: (value: string) => void;
  delay?: number;
  type?: "text" | "number";
  className?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
};

// Kontrolliertes Eingabefeld, das den Wert lokal haelt und erst nach
// `delay` ms Ruhe (oder bei Blur/Enter) per onCommit nach aussen gibt.
// Spart Firestore-Writes pro Tastendruck (F4).
export default function DebouncedInput({
  value,
  onCommit,
  delay = 500,
  type = "text",
  className,
  placeholder,
  min,
  max,
  step,
}: Props) {
  const [local, setLocal] = useState(String(value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  // Externe Aenderungen uebernehmen, solange der Nutzer nicht gerade tippt.
  useEffect(() => {
    if (!dirty.current) setLocal(String(value));
  }, [value]);

  function schedule(v: string) {
    setLocal(v);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      onCommit(v);
    }, delay);
  }

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (dirty.current) {
      dirty.current = false;
      onCommit(local);
    }
  }

  return (
    <input
      type={type}
      value={local}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      className={className}
      onChange={(e) => schedule(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === "Enter") flush();
      }}
    />
  );
}
