// c34 follow-up — WHO is acting, for the engines that used to read a raw
// user-id header (intake: `x-intake-user-id`, conflict-check: `x-user-id`).
//
// The answer now comes from the shared sign-in (src/auth/request.ts), the
// same session calendar, alerts, billing and ops already use:
//
//   AUTH_PROVIDER=clerk  the signed-in staff member from the verified session.
//                        The old headers are IGNORED: a client cannot make
//                        themselves staff by adding a header.
//   dev mode             the header still works (handy for API testing and for
//                        acting as a second staff member in the demo), but
//                        only outside production unless an operator opts in
//                        with ALLOW_DEV_USER_HEADER=1. With no header, a route
//                        that NEEDS staff falls back to the dev session's own
//                        user (DEV_USER_ID, or DEV_DEMO_USER on a demo).
//   none                 nobody is staff.
//
// "Optional" lookups (routes that serve both a client and a staff member,
// such as the intake chat steps) return null when no staff credential is
// present, so the client view is unchanged. In dev mode that means "no
// header": every dev request carries the dev session, so the session alone
// cannot tell a client from staff there.
//
// The id returned is only a claim of WHO; callers still load the user inside
// the tenant transaction and check the role (requireStaff, loadAccess), so an
// id from another firm or an inactive user gets no access.

import type { TenantTx } from "@/tenancy/withTenant";
import { HttpError } from "@/tenancy/route";
import { extractSessionToken, resolveAuthConfig, type AuthMode, type Env } from "./config";
import { UUID_RE } from "./providers";
import { requirePrincipal } from "./request";
import type { AuthRequest } from "./types";

export type StaffSource =
  | { kind: "header"; userId: string }
  | { kind: "session" }
  | { kind: "anonymous" }
  | { kind: "error"; status: number; message: string };

/** Pure: where the acting staff member comes from for this request. */
export function decideStaffSource(input: {
  mode: AuthMode;
  production: boolean;
  allowHeaderInProduction: boolean;
  headerValue: string | null | undefined;
  hasCredential: boolean;
  required: boolean;
}): StaffSource {
  const missing = (message: string): StaffSource =>
    input.required ? { kind: "error", status: 401, message } : { kind: "anonymous" };

  if (input.mode === "none") return missing("Staff sign-in is required.");

  if (input.mode === "clerk") {
    if (input.hasCredential) return { kind: "session" };
    return missing("Please sign in.");
  }

  // dev
  const headerAllowed = !input.production || input.allowHeaderInProduction;
  const raw = headerAllowed ? input.headerValue?.trim() : "";
  if (raw) {
    if (!UUID_RE.test(raw)) return { kind: "error", status: 400, message: "Invalid user id." };
    return { kind: "header", userId: raw };
  }
  return input.required ? { kind: "session" } : { kind: "anonymous" };
}

/** Adapt a Fetch Request to the provider-facing AuthRequest (headers + cookies). */
export function authRequestFrom(req: Pick<Request, "headers">): AuthRequest {
  return {
    header: (name) => req.headers.get(name),
    cookie: (name) => {
      const raw = req.headers.get("cookie");
      if (!raw) return null;
      for (const part of raw.split(";")) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() === name) {
          try {
            return decodeURIComponent(part.slice(eq + 1).trim());
          } catch {
            return part.slice(eq + 1).trim();
          }
        }
      }
      return null;
    },
  };
}

export interface StaffLookupOptions {
  /** Throw 401 when nobody is signed in (default), or return null. */
  required?: boolean;
  /** The legacy dev header this engine accepted. */
  header: string;
  env?: Env;
}

/**
 * The acting staff member's users.id for this request, or null (optional
 * lookups only). Throws HttpError 400/401/403.
 */
export async function resolveStaffUserId(
  tx: TenantTx,
  tenantId: string,
  req: Pick<Request, "headers">,
  opts: StaffLookupOptions
): Promise<string | null> {
  const env = opts.env ?? process.env;
  const config = resolveAuthConfig(env);
  const authReq = authRequestFrom(req);
  const source = decideStaffSource({
    mode: config.mode,
    production: env.NODE_ENV === "production",
    allowHeaderInProduction: env.ALLOW_DEV_USER_HEADER === "1",
    headerValue: req.headers.get(opts.header),
    hasCredential: extractSessionToken(authReq) !== null,
    required: opts.required ?? true,
  });

  switch (source.kind) {
    case "header":
      return source.userId;
    case "anonymous":
      return null;
    case "error":
      throw new HttpError(source.status, source.message);
    case "session": {
      const me = await requirePrincipal(tx, tenantId, undefined, authReq);
      if (!me.userId) {
        throw new HttpError(
          401,
          "Staff actions are recorded against a person: set DEV_USER_ID (or DEV_DEMO_USER on a demo deployment) to a real user."
        );
      }
      return me.userId;
    }
  }
}
