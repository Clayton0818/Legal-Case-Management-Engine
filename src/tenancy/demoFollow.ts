// c106 follow-up — let a DEMO deployment's dev-mode session follow the
// newest demo firm instead of one fixed firm id.
//
// Set DEV_TENANT_ID=current-demo (together with DEMO_RESET_ENABLED=1) on a
// demo deployment and every reset is picked up automatically: there is no
// firm id to copy into the environment after a reset any more. The lookup
// itself lives in src/engines/demo/follow.ts and only ever lands on a firm
// that carries the demo flag and is not a production firm, so this mode can
// never put a session on a real firm.
//
// This file is the synchronous half: the sentinel value and the result of
// the last lookup. It has no database access because getDevTenantId()
// (src/tenancy/devTenant.ts) is synchronous and is still used by a few
// routes, e.g. POST /api/intake/sessions behind /chat. The cache is kept on
// globalThis so that every server bundle in the same Node process (pages and
// route handlers) sees the same value.

export const CURRENT_DEMO_TENANT = "current-demo";

/** True when DEV_TENANT_ID asks to follow the newest demo firm. */
export function isFollowDemo(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === CURRENT_DEMO_TENANT;
}

export interface DemoSessionTarget {
  /** The current demo firm's id. */
  tenantId: string;
  /** users.id of the DEV_DEMO_USER staff member in that firm; null = the synthetic dev administrator. */
  userId: string | null;
  /** The DEV_DEMO_USER key the userId was resolved for (null when unset). */
  userKey: string | null;
  /** Date.now() of the lookup. */
  resolvedAt: number;
}

const CACHE_KEY = "__legalIntakeEngine_demoFollowTarget_v1";

function holder(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}

/** The last lookup, if it is no older than maxAgeMs (default: any age). */
export function getCachedDemoTarget(now = Date.now(), maxAgeMs = Number.POSITIVE_INFINITY): DemoSessionTarget | null {
  const hit = (holder()[CACHE_KEY] as DemoSessionTarget | null | undefined) ?? null;
  if (!hit) return null;
  return now - hit.resolvedAt <= maxAgeMs ? hit : null;
}

/** Store (or, with null, forget) the current demo firm for this server process. */
export function setCachedDemoTarget(target: Omit<DemoSessionTarget, "resolvedAt"> | null, now = Date.now()): void {
  holder()[CACHE_KEY] = target ? { ...target, resolvedAt: now } : null;
}
