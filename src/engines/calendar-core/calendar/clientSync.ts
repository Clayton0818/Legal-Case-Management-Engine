// c111 — write a confirmed calendar event to a CLIENT's own calendar once
// they accept a scheduling RSVP sent by email (Clayton approved this on
// 2026-10-15), the same way c91 already syncs the firm's matter calendar to
// Outlook/Google — but gated on a calendar-write GRANT from the client
// (never assumed) and on the same shared 'vendor.calendar_sync' approval
// gate c91 already uses (src/compliance/gates.ts VENDOR_GATES.calendarSync
// — reused, never redefined).
//
// Pure domain logic + a stub write adapter only in this PR, the same
// scoping precedent c77/c78/c80/c81 already used in this codebase (see the
// header notes in billing-trust/payments.ts and timeEntries.ts): no new DB
// table for a client's calendar-write grant, no API route, and no real
// OAuth/writer wired up yet. "An RSVP sent to a client" today (the booking
// confirmation src/engines/intake/booking/service.ts's confirmBooking()
// sends via notifyParty() once a consultation is booked) only updates the
// firm's side — this module decides WHETHER and WHAT should be pushed to
// the client's own calendar once they accept, never how a grant is
// captured, how "accepted" reaches us, or how a real provider is called.
//
// The rule this exists to protect: writing to a client's personal calendar
// needs the client's OWN affirmative calendar-write grant, every time — a
// push is never attempted just because the firm's event is confirmed, a
// missing or revoked grant always holds (never silently skipped with no
// reason), and a declined or tentative RSVP never reaches the adapter at
// all, the same discipline sync.ts already applies to a pending vendor gate.

import { placeholderFor } from "@/compliance/approvals";
import { VENDOR_GATES } from "@/compliance/gates";
import type { CalendarEventRow } from "./events";
import { syncApproved, toExternalPayload, type ExternalEventPayload, type PushResult, type SyncOp, type SyncProviderName } from "./sync";

export const RSVP_RESPONSES = ["accepted", "declined", "tentative"] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

/**
 * A client's own consent to write matter-scheduling events to their
 * personal calendar. Captured once (outside this module — the real OAuth
 * flow is a follow-up), revocable at any time by the client.
 */
export interface ClientCalendarGrant {
  partyId: string;
  provider: SyncProviderName;
  /** Secret-store reference, never a token — same convention as ./sync.ts's ConnectionRef. */
  tokenRef: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}

/** An active (granted, unrevoked) grant. Pure. */
export function hasActiveGrant(grant: ClientCalendarGrant | null): grant is ClientCalendarGrant {
  return grant !== null && grant.revokedAt === null;
}

export interface ClientPushPlan {
  op: SyncOp | "none";
  payload: ExternalEventPayload | null;
  /** Why nothing is being pushed. Always set when op is "none"; null otherwise. */
  reason: string | null;
}

/**
 * What (if anything) should be pushed to a client's own calendar after an
 * RSVP response. Pure — a client calendar write is planned only when ALL of:
 * the client's response was "accepted" (never "declined" or "tentative"),
 * they hold an active calendar-write grant (never granted, or revoked, both
 * hold), and the shared vendor gate is approved. Every other case holds
 * with a stated reason, exactly like a held link in ./sync.ts — never a
 * silent no-op with no explanation.
 */
export function planClientCalendarPush(
  event: Pick<CalendarEventRow, "title" | "startsAt" | "endsAt" | "allDay" | "location" | "status">,
  response: RsvpResponse,
  grant: ClientCalendarGrant | null,
  opts: { vendorApproved?: boolean; alreadyPushed?: boolean } = {}
): ClientPushPlan {
  if (response !== "accepted") {
    return { op: "none", payload: null, reason: `The client's RSVP response was '${response}', not 'accepted'.` };
  }
  if (event.status === "cancelled") {
    return opts.alreadyPushed
      ? { op: "delete", payload: null, reason: null }
      : { op: "none", payload: null, reason: "The event was cancelled before it was ever pushed to the client's calendar." };
  }
  if (!hasActiveGrant(grant)) {
    return {
      op: "none",
      payload: null,
      reason: grant ? "The client revoked their calendar-write grant." : "The client has not granted calendar-write access.",
    };
  }
  const approved = opts.vendorApproved ?? syncApproved();
  if (!approved) {
    return { op: "none", payload: null, reason: placeholderFor(VENDOR_GATES.calendarSync.key) };
  }
  return { op: opts.alreadyPushed ? "update" : "create", payload: toExternalPayload(event), reason: null };
}

// ---------------------------------------------------------------------------
// Vendor adapter (vendor.calendar_sync — reused from src/compliance/gates.ts,
// the very same gate ./sync.ts already gates the firm-side push on; never a
// second, redefined gate). No real OAuth or provider call in this PR: the
// only adapter below is the stub, which records instead of writing.
// ---------------------------------------------------------------------------

export interface ClientCalendarWriteRequest {
  tenantId: string;
  grant: ClientCalendarGrant;
  op: SyncOp;
  payload: ExternalEventPayload | null;
  externalId: string | null;
}

export interface ClientCalendarWriteAdapter {
  readonly name: string;
  readonly isStub: boolean;
  write(request: ClientCalendarWriteRequest): Promise<PushResult>;
}

/** Records what would have been written instead of calling a real provider. */
export class StubClientCalendarWriteAdapter implements ClientCalendarWriteAdapter {
  readonly name = "stub";
  readonly isStub = true;
  readonly recorded: ClientCalendarWriteRequest[] = [];

  async write(request: ClientCalendarWriteRequest): Promise<PushResult> {
    this.recorded.push(request);
    return { outcome: "held", detail: "Stub client calendar adapter: recorded, not written." };
  }
}

let adapter: ClientCalendarWriteAdapter = new StubClientCalendarWriteAdapter();

export function getClientCalendarWriteAdapter(): ClientCalendarWriteAdapter {
  return adapter;
}

/** Swap in a real adapter (only once a client calendar-write flow is actually wired up). */
export function setClientCalendarWriteAdapter(next: ClientCalendarWriteAdapter): void {
  adapter = next;
}

/** Applies a push plan through an adapter. Returns null when the plan is "none" (nothing to do). */
export async function applyClientCalendarPush(
  writeAdapter: ClientCalendarWriteAdapter,
  tenantId: string,
  grant: ClientCalendarGrant,
  plan: ClientPushPlan,
  externalId: string | null
): Promise<PushResult | null> {
  if (plan.op === "none") return null;
  return writeAdapter.write({ tenantId, grant, op: plan.op, payload: plan.payload, externalId });
}
