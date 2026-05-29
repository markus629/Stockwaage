"use client";

import { useEffect, useRef, useState } from "react";

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string | number;
  onCommit: (value: string) => void;
  delay?: number;
};

// Eingabefeld, das NICHT bei jedem Tastendruck nach Firestore schreibt,
// sondern erst nach `delay` ms Ruhe (Debounce) bzw. beim Verlassen (onBlur).
// Spart Writes bei Namen-/Zahlenfeldern (z.B. "Beute 1" = 1 statt 9 Writes).
export default function DebouncedInput({
  value,
  onCommit,
  delay = 500,
  ...rest
}: Props) {
  const [local, setLocal] = useState(String(value));
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Externe Aenderungen uebernehmen, solange der Nutzer nicht selbst tippt.
  useEffect(() => {
    if (!focused.current) setLocal(String(value));
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function schedule(v: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(v), delay);
  }

  function commitNow(v: string) {
    if (timer.current) clearTimeout(timer.current);
    onCommit(v);
  }

  return (
    <input
      {...rest}
      value={local}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setLocal(e.target.value);
        schedule(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        commitNow(local);
      }}
    />
  );
}
