// c106 follow-up — resolve DEV_TENANT_ID=current-demo to the newest demo
// firm and, when DEV_DEMO_USER is set, to one of its fictional staff.
//
// Why: every reset creates a NEW demo firm (append-only history is never
// deleted), so a fixed DEV_TENANT_ID / DEV_USER_ID had to be re-typed into
// the deployment's environment after every reset. With this mode the dev
// session simply follows whichever demo firm is current.
//
// Safety, in order:
//  - only on a demo deployment: refused unless DEMO_RESET_ENABLED=1;
//  - the firm comes from the demo engine's own lookup (currentDemoTenant):
//    non-production firms with an ACTIVE demo flag only, newest first;
//  - the flag is checked again inside that firm's own transaction
//    (assertDemoTenant) before the session is pointed at it;
//  - DEV_DEMO_USER is a fixture key ('partner', 'admin', …), never an id
//    from the request, and is looked up by the fixture's example.com email
//    inside the demo firm only.
// So this mode can never land a session on a real firm, which a hand-typed
// DEV_TENANT_ID can.

import { and, eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { getCachedDemoTarget, isFollowDemo, setCachedDemoTarget, type DemoSessionTarget } from "@/tenancy/demoFollow";
import { DEMO_STAFF, staffByKey, type StaffKey } from "./fixtures";
import { assertDemoTenant } from "./guard";
import { currentDemoTenant, demoResetEnabled, type TenantRunner } from "./reset";

/** Not a firm: a scope that sees only the (not tenant-scoped) firms list. Same value /api/demo/bootstrap uses. */
export const NO_TENANT_SCOPE = "00000000-0000-4000-8000-000000000000";

/** A lookup is reused for this long. A reset or bootstrap on this server refreshes it at once. */
export const DEMO_FOLLOW_TTL_MS = 30_000;

export type DemoFollowRefusal = "demo_off" | "no_demo_firm" | "unknown_user_key" | "demo_user_missing";

export class DemoFollowError extends Error {
  constructor(
    message: string,
    readonly code: DemoFollowRefusal
  ) {
    super(message);
    this.name = "DemoFollowError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** DEV_DEMO_USER → a demo staff key. Empty = the synthetic dev administrator. Throws on an unknown key. */
export function parseDemoUserKey(value: string | undefined): StaffKey | null {
  const v = value?.trim();
  if (!v) return null;
  const staff = DEMO_STAFF.find((s) => s.key === v);
  if (!staff) {
    throw new DemoFollowError(
      `DEV_DEMO_USER='${v}' is not one of the demo firm's staff. Use one of: ${DEMO_STAFF.map((s) => s.key).join(", ")}, or leave it unset for the dev administrator.`,
      "unknown_user_key"
    );
  }
  return staff.key;
}

/** The database steps, injectable so the decision logic can be tested without a database. */
export interface DemoFollowDeps {
  /** The newest active demo firm, or null when there is none. */
  findCurrentDemoFirm(): Promise<{ tenantId: string } | null>;
  /** Re-check the demo flag inside that firm's own transaction; return the users.id for `email` there (null when no email). */
  confirmFirmAndFindUser(tenantId: string, email: string | null): Promise<string | null>;
}

export function dbDemoFollowDeps(run: TenantRunner): DemoFollowDeps {
  return {
    findCurrentDemoFirm: () => currentDemoTenant(run, NO_TENANT_SCOPE),
    confirmFirmAndFindUser: (tenantId, email) =>
      run(tenantId, async (tx) => {
        await assertDemoTenant(tx, tenantId);
        if (!email) return null;
        const [u] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
          .limit(1);
        return u?.id ?? null;
      }),
  };
}

/** Which demo firm (and which fictional staff member) a current-demo session should use right now. */
export async function resolveDemoTarget(
  deps: DemoFollowDeps,
  opts: { env?: Env; now?: number; force?: boolean } = {}
): Promise<DemoSessionTarget> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  if (!demoResetEnabled(env)) {
    throw new DemoFollowError(
      "DEV_TENANT_ID=current-demo only works on a demo deployment (set DEMO_RESET_ENABLED=1 there, and nowhere else).",
      "demo_off"
    );
  }
  const userKey = parseDemoUserKey(env.DEV_DEMO_USER);
  if (!opts.force) {
    const hit = getCachedDemoTarget(now, DEMO_FOLLOW_TTL_MS);
    if (hit && hit.userKey === userKey) return hit;
  }
  const current = await deps.findCurrentDemoFirm();
  if (!current) {
    setCachedDemoTarget(null);
    throw new DemoFollowError('There is no demo firm on this deployment yet. Open /demo and use "Create the demo firm".', "no_demo_firm");
  }
  const userId = await deps.confirmFirmAndFindUser(current.tenantId, userKey ? staffByKey(userKey).email : null);
  if (userKey && !userId) {
    throw new DemoFollowError(`DEV_DEMO_USER='${userKey}' was not found in the current demo firm.`, "demo_user_missing");
  }
  const target: DemoSessionTarget = { tenantId: current.tenantId, userId, userKey, resolvedAt: now };
  setCachedDemoTarget({ tenantId: target.tenantId, userId: target.userId, userKey: target.userKey }, now);
  return target;
}

/**
 * After a reset or bootstrap: on a current-demo deployment, look the demo
 * firm up again straight away so the very next request (including the
 * synchronous getDevTenantId() routes) uses the new firm. Returns whether
 * this deployment follows the current demo firm. Never throws: if the
 * lookup fails, the cache is cleared and the next request looks again.
 */
export async function refreshDemoTarget(run: TenantRunner, env: Env = process.env): Promise<boolean> {
  if (!isFollowDemo(env.DEV_TENANT_ID)) return false;
  try {
    await resolveDemoTarget(dbDemoFollowDeps(run), { env, force: true });
  } catch {
    setCachedDemoTarget(null);
  }
  return true;
}
