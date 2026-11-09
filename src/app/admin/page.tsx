// Matters queue (board card c24). Tenant-scoped via withTenant() +
// getDevTenantId() per ADR-0001 §D5 — see src/tenancy/devTenant.ts for why
// this is a temporary stand-in for real auth rather than a new mechanism.
import Link from "next/link";
import { getDevTenantId } from "@/tenancy/devTenant";
import { listMattersForTenant } from "./_lib/queries";
import { formatDate, formatEnumLabel, stageBadgeClass } from "./_lib/format";

// Tenant-scoped data must never be served from Next's static/full route
// cache — a cached response for one firm must not be reused for another,
// and dev-tenant data can change between requests regardless.
export const dynamic = "force-dynamic";

/** Stages where a person at the firm has to act next (same grouping as the "review" pill in _lib/format.ts). */
const ATTENTION_STAGES = new Set(["consult_completed_manual_follow_up", "pending_review"]);

function initials(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "—";
}

export default async function AdminHome() {
  const tenantId = getDevTenantId();
  // withTenant (and, transitively, src/tenancy/db.ts) is imported lazily,
  // not statically at module scope. db.ts throws at import time if
  // DATABASE_URL is unset, and `next build`'s "collecting page data" step
  // actually loads every route/page module to inspect it — a static
  // top-level import here would make DATABASE_URL a *build-time*
  // requirement (CI's build step deliberately runs without it; see
  // .github/workflows/ci.yml).
  const { withTenant } = await import("@/tenancy/withTenant");
  const matterRows = await withTenant(tenantId, (tx) => listMattersForTenant(tx, tenantId));

  const needsAttention = matterRows.filter((m) => ATTENTION_STAGES.has(m.stage)).length;

  return (
    <div className="space-y-12">
      {/* Hero (calm light shell, founder-approved mockup 2026-11-09) */}
      <section className="mx-auto max-w-2xl pt-4 text-center md:pt-10">
        <h1 className="!text-[2.6rem] !font-normal !leading-[1.08] !tracking-[-0.025em] md:!text-[3.4rem]">
          A calmer way
          <br />
          to run the practice.
        </h1>
        <p className="mt-4 text-[0.95rem] text-slate-500">
          {matterRows.length === 0
            ? "No matters yet."
            : needsAttention > 0
              ? `${needsAttention} matter${needsAttention === 1 ? " needs" : "s need"} attention today.`
              : `${matterRows.length} matter${matterRows.length === 1 ? "" : "s"}, nothing waiting on you.`}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/admin/intake"
            className="inline-flex min-h-[44px] items-center rounded-full border border-black/[0.06] bg-white px-5 text-sm font-medium text-slate-900 shadow-sm transition hover:-translate-y-px hover:shadow-md"
          >
            + New Matter
          </Link>
          <Link href="/admin/insights" className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm text-slate-500 transition hover:text-slate-900">
            View insights →
          </Link>
          <Link href="/demo" className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm text-slate-500 transition hover:text-slate-900">
            Demo (fictional data) →
          </Link>
        </div>
      </section>

      {matterRows.length === 0 ? null : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {matterRows.map((matter) => (
            <li key={matter.id}>
              <Link
                href={`/admin/matters/${matter.id}`}
                className="glass-card flex h-full flex-col rounded-[1.25rem] p-5 focus-visible:outline-offset-4"
              >
                <span className="truncate text-[0.95rem] font-semibold text-slate-900">{matter.partyName ?? "Unknown party"}</span>
                <span className="mt-0.5 truncate text-[0.8rem] text-slate-500">{matter.practiceArea ? formatEnumLabel(matter.practiceArea) : "Practice area not set"}</span>
                <span className={`mt-3 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-medium ${stageBadgeClass(matter.stage)}`}>
                  {formatEnumLabel(matter.stage)}
                </span>
                <span className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3.5 text-[0.8rem]">
                  <span className="flex min-w-0 items-center gap-2 text-slate-700">
                    <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[0.6rem] font-semibold text-slate-600">
                      {initials(matter.assignedUserName)}
                    </span>
                    <span className="truncate">{matter.assignedUserName ?? "Unassigned"}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-slate-400">
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <rect x="2" y="3" width="12" height="11" rx="2" />
                      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
                    </svg>
                    {formatDate(matter.openedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
