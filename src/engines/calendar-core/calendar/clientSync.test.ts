import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetApprovalStateForTests, setApprovals } from "@/compliance/approvals";
import { VENDOR_GATES } from "@/compliance/gates";
import {
  applyClientCalendarPush,
  hasActiveGrant,
  planClientCalendarPush,
  StubClientCalendarWriteAdapter,
  type ClientCalendarGrant,
} from "./clientSync";
import type { CalendarEventRow } from "./events";

function event(overrides: Partial<Pick<CalendarEventRow, "title" | "startsAt" | "endsAt" | "allDay" | "location" | "status">> = {}) {
  return {
    title: "Initial consultation",
    startsAt: new Date("2026-12-01T15:00:00Z"),
    endsAt: new Date("2026-12-01T15:30:00Z"),
    allDay: false,
    location: "Office",
    status: "confirmed",
    ...overrides,
  } as Pick<CalendarEventRow, "title" | "startsAt" | "endsAt" | "allDay" | "location" | "status">;
}

function grant(overrides: Partial<ClientCalendarGrant> = {}): ClientCalendarGrant {
  return {
    partyId: "party-1",
    provider: "google",
    tokenRef: "secret-ref-1",
    grantedAt: new Date("2026-10-15T00:00:00Z"),
    revokedAt: null,
    ...overrides,
  };
}

describe("hasActiveGrant", () => {
  it("is false for null", () => {
    expect(hasActiveGrant(null)).toBe(false);
  });
  it("is false once revoked", () => {
    expect(hasActiveGrant(grant({ revokedAt: new Date() }))).toBe(false);
  });
  it("is true for an ungranted-never, unrevoked grant", () => {
    expect(hasActiveGrant(grant())).toBe(true);
  });
});

describe("planClientCalendarPush", () => {
  it("never pushes on a declined response, even with an active grant and approved vendor", () => {
    const plan = planClientCalendarPush(event(), "declined", grant(), { vendorApproved: true });
    expect(plan.op).toBe("none");
    expect(plan.reason).toMatch(/'declined'/);
  });

  it("never pushes on a tentative response", () => {
    const plan = planClientCalendarPush(event(), "tentative", grant(), { vendorApproved: true });
    expect(plan.op).toBe("none");
    expect(plan.reason).toMatch(/'tentative'/);
  });

  it("holds with a stated reason when there is no grant at all", () => {
    const plan = planClientCalendarPush(event(), "accepted", null, { vendorApproved: true });
    expect(plan.op).toBe("none");
    expect(plan.reason).toMatch(/has not granted/);
  });

  it("holds with a stated reason once the client revokes their grant", () => {
    const plan = planClientCalendarPush(event(), "accepted", grant({ revokedAt: new Date() }), { vendorApproved: true });
    expect(plan.op).toBe("none");
    expect(plan.reason).toMatch(/revoked/);
  });

  it("holds with the shared vendor-gate placeholder while vendor.calendar_sync is unapproved", () => {
    const plan = planClientCalendarPush(event(), "accepted", grant(), { vendorApproved: false });
    expect(plan.op).toBe("none");
    expect(plan.reason).toMatch(/PENDING/i);
  });

  it("plans a create, with a minimal payload, once accepted + granted + approved", () => {
    const plan = planClientCalendarPush(event(), "accepted", grant(), { vendorApproved: true });
    expect(plan.op).toBe("create");
    expect(plan.reason).toBeNull();
    expect(plan.payload?.title).toBe("Initial consultation");
  });

  it("plans an update, not a create, once already pushed once", () => {
    const plan = planClientCalendarPush(event(), "accepted", grant(), { vendorApproved: true, alreadyPushed: true });
    expect(plan.op).toBe("update");
  });

  it("never mixes a privileged description into the client payload (same minimal shape as sync.ts)", () => {
    const plan = planClientCalendarPush(event(), "accepted", grant(), { vendorApproved: true });
    expect(plan.payload).not.toHaveProperty("description");
  });

  describe("cancellation", () => {
    it("is a no-op if the event was cancelled before any push happened", () => {
      const plan = planClientCalendarPush(event({ status: "cancelled" }), "accepted", grant(), { vendorApproved: true, alreadyPushed: false });
      expect(plan.op).toBe("none");
      expect(plan.reason).toMatch(/cancelled/);
    });

    it("plans a delete once a previously-pushed event is cancelled", () => {
      const plan = planClientCalendarPush(event({ status: "cancelled" }), "accepted", grant(), { vendorApproved: true, alreadyPushed: true });
      expect(plan.op).toBe("delete");
      expect(plan.reason).toBeNull();
    });
  });
});

describe("real vendor-gate wiring (isApproved/placeholderFor, not a mocked flag)", () => {
  beforeEach(() => resetApprovalStateForTests());
  afterEach(() => resetApprovalStateForTests());

  it("holds by default — nothing is approved out of the box", () => {
    const plan = planClientCalendarPush(event(), "accepted", grant());
    expect(plan.op).toBe("none");
    expect(plan.reason).toMatch(/PENDING/i);
  });

  it("plans a create once the shared vendor.calendar_sync gate is actually approved", () => {
    setApprovals([{ gateKey: VENDOR_GATES.calendarSync.key, reviewerKind: "vendor_dpa", approvedByName: "Vendor Reviewer", approvedAt: new Date() }]);
    const plan = planClientCalendarPush(event(), "accepted", grant());
    expect(plan.op).toBe("create");
  });
});

describe("applyClientCalendarPush", () => {
  it("never calls the adapter when the plan is 'none'", async () => {
    const adapter = new StubClientCalendarWriteAdapter();
    const plan = planClientCalendarPush(event(), "declined", grant(), { vendorApproved: true });
    const result = await applyClientCalendarPush(adapter, "t1", grant(), plan, null);
    expect(result).toBeNull();
    expect(adapter.recorded).toHaveLength(0);
  });

  it("records instead of writing once there is something to push", async () => {
    const adapter = new StubClientCalendarWriteAdapter();
    const g = grant();
    const plan = planClientCalendarPush(event(), "accepted", g, { vendorApproved: true });
    const result = await applyClientCalendarPush(adapter, "t1", g, plan, null);
    expect(result?.outcome).toBe("held");
    expect(adapter.recorded).toHaveLength(1);
    expect(adapter.recorded[0]?.op).toBe("create");
    expect(adapter.recorded[0]?.grant.partyId).toBe("party-1");
  });
});
