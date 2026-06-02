"use client";

// Stern zum Anheften/Lösen einer Kachel aufs Dashboard (gleiche Optik wie
// bei den Waagen).
export default function StarToggle({
  on,
  onClick,
}: {
  on: boolean;
  onClick: () => void;
}) {
  const label = on ? "Vom Dashboard entfernen" : "Aufs Dashboard";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`rounded p-1 ${
        on
          ? "text-amber-500 hover:bg-amber-50"
          : "text-neutral-300 hover:bg-neutral-100 hover:text-neutral-500"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 1.5l2.6 5.3 5.9.86-4.25 4.14 1 5.85L10 14.77 4.75 17.65l1-5.85L1.5 7.66l5.9-.86L10 1.5z" />
      </svg>
    </button>
  );
}
