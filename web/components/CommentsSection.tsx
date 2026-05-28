"use client";

import { useState } from "react";
import {
  addComment,
  deleteComment,
  updateComment,
  type Comment,
} from "@/lib/devices";

type Props = {
  deviceId: string;
  scaleId: string;
  comments: Comment[];
};

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CommentsSection({
  deviceId,
  scaleId,
  comments,
}: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const sorted = [...comments].sort((a, b) => b.ts - a.ts);

  async function add() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await addComment(deviceId, scaleId, t);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const t = editText.trim();
    if (!t) return;
    await updateComment(deviceId, id, t);
    setEditingId(null);
    setEditText("");
  }

  return (
    <div className="mt-3">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
        Logbuch
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          placeholder="z.B. Honig entnommen, gefüttert, Schwarm…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !text.trim()}
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          +
        </button>
      </div>

      {sorted.length > 0 && (
        <ul className="mt-2 divide-y divide-neutral-100 rounded border border-neutral-200">
          {sorted.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 text-sm"
            >
              <span className="w-28 shrink-0 font-mono text-xs text-neutral-500">
                {fmt(c.ts)}
              </span>
              {editingId === c.id ? (
                <input
                  type="text"
                  value={editText}
                  autoFocus
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-0.5 text-sm"
                />
              ) : (
                <span className="min-w-0 flex-1 break-words">{c.text}</span>
              )}
              {editingId === c.id ? (
                <button
                  type="button"
                  onClick={() => saveEdit(c.id)}
                  className="shrink-0 rounded px-1 text-xs text-green-700 hover:bg-green-50"
                >
                  ✓
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Bearbeiten"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditText(c.text);
                  }}
                  className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M13.6 2.6a1.4 1.4 0 0 1 2 2l-9 9-2.7.7.7-2.7 9-9z" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                aria-label="Löschen"
                onClick={() => {
                  if (confirm("Kommentar löschen?")) {
                    deleteComment(deviceId, c.id);
                  }
                }}
                className="shrink-0 rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
              >
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M6 6l8 8M14 6l-8 8"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
