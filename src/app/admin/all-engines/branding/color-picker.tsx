"use client";

// Accent-color picker. PUT /api/all-engines/branding sets or clears
// firmSettings.brandAccentColor (settings.manage); the page reloads so the
// new --brand value takes effect everywhere (set in admin/layout.tsx).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { send } from "../_lib/send";

const DEFAULT_COLOR = "#5E5CE6";
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const PRESETS = [
  { label: "Violet (default)", value: "#5E5CE6" },
  { label: "Blue", value: "#0A84FF" },
  { label: "Teal", value: "#30B0C7" },
  { label: "Green", value: "#34C759" },
  { label: "Rose", value: "#FF375F" },
  { label: "Amber", value: "#FF9F0A" },
] as const;

export function ColorPicker({ initialColor }: { initialColor: string | null }) {
  const router = useRouter();
  const [color, setColor] = useState(initialColor ?? DEFAULT_COLOR);
  const [hexInput, setHexInput] = useState(initialColor ?? DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function apply(next: string | null) {
    const err = await send("/api/all-engines/branding", "PUT", { color: next });
    setError(err);
    if (!err) start(() => router.refresh());
  }

  function commitHex() {
    if (!HEX_COLOR.test(hexInput)) {
      setError("Enter a 6-digit hex code like #5E5CE6.");
      return;
    }
    setColor(hexInput);
    void apply(hexInput);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            title={p.label}
            aria-label={p.label}
            aria-pressed={color.toLowerCase() === p.value.toLowerCase()}
            disabled={pending}
            onClick={() => {
              setColor(p.value);
              setHexInput(p.value);
              void apply(p.value);
            }}
            className={`h-9 w-9 rounded-full ring-offset-2 transition ${
              color.toLowerCase() === p.value.toLowerCase() ? "ring-2 ring-slate-900" : "ring-1 ring-slate-200 hover:ring-slate-400"
            }`}
            style={{ backgroundColor: p.value }}
          />
        ))}
        <span className="mx-1 h-9 w-px bg-slate-200" aria-hidden="true" />
        <span className="h-9 w-9 shrink-0 rounded-full ring-1 ring-slate-200" style={{ backgroundColor: color }} aria-hidden="true" />
        <input
          className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitHex();
          }}
          placeholder="#5E5CE6"
          maxLength={7}
          disabled={pending}
        />
        <button
          type="button"
          disabled={pending || initialColor === null}
          onClick={() => {
            setColor(DEFAULT_COLOR);
            setHexInput(DEFAULT_COLOR);
            void apply(null);
          }}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          Reset to default
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
