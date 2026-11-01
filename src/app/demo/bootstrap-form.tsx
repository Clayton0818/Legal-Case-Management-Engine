"use client";

// Create the FIRST demo firm from /demo (c106), with no terminal and no
// database connection string. It calls POST /api/demo/bootstrap, which
// refuses unless this deployment has DEMO_RESET_ENABLED=1 and a
// DEMO_BOOTSTRAP_SECRET that matches the one typed here, and refuses again
// once a demo firm exists. The secret is sent once in a request header and
// never stored in the page.

import { useState } from "react";

interface BootstrapResponse {
  tenantId?: string;
  generation?: number;
  summary?: { ok: number; blocked: number; failed: number };
  next?: string;
  error?: string;
}

export function BootstrapDemoForm() {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BootstrapResponse | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!secret.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/demo/bootstrap", { method: "POST", headers: { "x-demo-bootstrap-secret": secret.trim() } });
      const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as BootstrapResponse;
      setResult(res.ok ? body : { error: body.error ?? `HTTP ${res.status}` });
      if (res.ok) setSecret("");
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs font-medium text-slate-700">
          Bootstrap secret (DEMO_BOOTSTRAP_SECRET on this deployment)
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="mt-1 w-72 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !secret.trim()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {busy ? "Creating the demo firm… (about a minute)" : "Create the demo firm"}
        </button>
      </form>
      {result?.error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">Refused: {result.error}</p>}
      {result?.tenantId && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">
          <p>
            Demo firm created: <code>{result.tenantId}</code>. Seed steps: {result.summary?.ok} ok, {result.summary?.blocked} blocked pending review,{" "}
            {result.summary?.failed} failed.
          </p>
          {result.next && <p className="mt-1">{result.next}</p>}
          <button type="button" className="mt-1 underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
