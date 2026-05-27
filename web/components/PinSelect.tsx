"use client";

type Props = {
  value: number;
  allowed: readonly number[];
  pinOwners: Record<number, string>;
  ownerKey: string;
  onChange: (v: number) => void;
  defaultMarker?: number;
  className?: string;
};

export default function PinSelect({
  value,
  allowed,
  pinOwners,
  ownerKey,
  onChange,
  defaultMarker,
  className = "mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm",
}: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
      className={className}
    >
      {allowed.map((p) => {
        const owner = pinOwners[p];
        const isSelf = owner === ownerKey;
        const disabled = !!owner && !isSelf;
        return (
          <option key={p} value={p} disabled={disabled}>
            GPIO {p}
            {defaultMarker === p ? " (Standard)" : ""}
            {disabled ? ` — belegt von ${owner}` : ""}
          </option>
        );
      })}
    </select>
  );
}
