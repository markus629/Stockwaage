"use client";

// Stilisiertes Bienenstock-Logo (Magazin-/Langstroth-Beute) im Honig-Look.
// variant "single" -> eine Beute (C5 = eine Waage),
// variant "multi"  -> mehrere Beuten (S3 = Bienenstand mit mehreren Waagen).
// Rein dekorativ (aria-hidden); macht den Geraetetyp auf einen Blick klar.

type Variant = "single" | "multi";

// Eine einzelne Beute, gezeichnet in einer ~24x26-Zelle mit Ursprung oben
// links. Wird per <g transform> platziert/skaliert.
function Hive({
  transform,
  bee = false,
}: {
  transform?: string;
  bee?: boolean;
}) {
  return (
    <g transform={transform}>
      {/* Dach */}
      <path d="M11.5 3.2 1.8 8.4h19.4z" fill="#92400e" />
      <rect x="2.4" y="8" width="18.2" height="2.6" rx="1.1" fill="#b45309" />
      {/* Zargen (Honigräume) */}
      <rect x="3.8" y="10.8" width="15.4" height="4" rx="1.1" fill="#f59e0b" />
      <rect x="3.8" y="15" width="15.4" height="4" rx="1.1" fill="#fbbf24" />
      <rect x="3.8" y="19.2" width="15.4" height="4" rx="1.1" fill="#f59e0b" />
      {/* Flugloch */}
      <rect x="9" y="20.4" width="5" height="1.9" rx="0.95" fill="#7c2d12" />
      {bee && <Bee transform="translate(19 2.5) scale(0.9)" />}
    </g>
  );
}

// Kleine fliegende Biene als Akzent.
function Bee({ transform }: { transform?: string }) {
  return (
    <g transform={transform}>
      {/* Flügel */}
      <ellipse cx="-1" cy="-1.6" rx="2.1" ry="1.3" fill="#fef9c3" opacity="0.95" />
      <ellipse cx="1" cy="-1.6" rx="2.1" ry="1.3" fill="#fef9c3" opacity="0.95" />
      {/* Körper */}
      <ellipse cx="0" cy="0.6" rx="2.4" ry="1.9" fill="#fcd34d" stroke="#78350f" strokeWidth="0.5" />
      <path d="M-0.7 -1 -0.7 2.1M0.7 -1 0.7 2.1" stroke="#78350f" strokeWidth="0.7" strokeLinecap="round" />
    </g>
  );
}

export default function HiveLogo({
  variant,
  className = "h-10 w-10",
}: {
  variant: Variant;
  className?: string;
}) {
  if (variant === "multi") {
    return (
      <svg viewBox="0 0 34 28" className={className} aria-hidden="true">
        {/* hintere, kleinere Beute */}
        <Hive transform="translate(15 0.5) scale(0.62)" />
        {/* vordere Hauptbeute mit Biene */}
        <Hive transform="translate(-1 2) scale(0.82)" bee />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 27" className={className} aria-hidden="true">
      <Hive transform="translate(0.4 0.6)" bee />
    </svg>
  );
}
