// Request helpers for the intake API routes.
//
// ACTING USER: the signed-in staff member from the shared sign-in (c34,
// src/auth/staff.ts). The old `x-intake-user-id` header is honoured in dev
// mode only. Nothing trusts a client-supplied ROLE: every service re-reads
// the user row inside the tenant transaction and checks the role itself.

import type { TenantTx } from "@/tenancy/withTenant";
import { HttpError } from "@/tenancy/route";
import { resolveStaffUserId } from "@/auth/staff";
import { requireStaff, STAFF_ROLES, type UserRole } from "@/engines/intake/common/actors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Body = Record<string, unknown>;

export async function readJson(req: Request): Promise<Body> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Request body must be a JSON object.");
  return body as Body;
}

export function uuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new HttpError(400, `${name} must be a UUID.`);
  return value;
}

export function optionalUuid(value: unknown, name: string): string | null {
  return value === undefined || value === null || value === "" ? null : uuid(value, name);
}

export function str(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `'${key}' is required.`);
  return v;
}

export function optionalStr(body: Body, key: string): string | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new HttpError(400, `'${key}' must be a string.`);
  return v;
}

export function date(body: Body, key: string): Date {
  const v = body[key];
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw new HttpError(400, `'${key}' must be an ISO date-time.`);
  return d;
}

export function optionalDate(body: Body, key: string): Date | null {
  return body[key] === undefined || body[key] === null ? null : date(body, key);
}

export function bool(body: Body, key: string): boolean {
  if (typeof body[key] !== "boolean") throw new HttpError(400, `'${key}' must be true or false.`);
  return body[key] as boolean;
}

export function stringArray(body: Body, key: string, required = false): string[] {
  const v = body[key];
  if (v === undefined && !required) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new HttpError(400, `'${key}' must be an array of strings.`);
  return v as string[];
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new HttpError(400, `${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

/** The intake engine's old dev header (dev mode only; see src/auth/staff.ts). */
export const INTAKE_DEV_USER_HEADER = "x-intake-user-id";

/**
 * The signed-in staff member's id, or null when the caller is not staff (a
 * client using the intake chat). See src/auth/staff.ts for where it comes from.
 */
export async function actingUserId(tx: TenantTx, tenantId: string, req: Request): Promise<string | null> {
  return resolveStaffUserId(tx, tenantId, req, { header: INTAKE_DEV_USER_HEADER, required: false });
}

/** The signed-in staff member's id; HTTP 401 when nobody is signed in. */
export async function requireActingUserId(tx: TenantTx, tenantId: string, req: Request): Promise<string> {
  return (await resolveStaffUserId(tx, tenantId, req, { header: INTAKE_DEV_USER_HEADER, required: true }))!;
}

export async function requireActingStaff(tx: TenantTx, tenantId: string, req: Request, roles: readonly UserRole[] = STAFF_ROLES, action = "use the intake console") {
  return requireStaff(tx, tenantId, await requireActingUserId(tx, tenantId, req), roles, action);
}
