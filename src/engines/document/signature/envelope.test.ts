import { describe, expect, it } from "vitest";
import {
  canCompleteAgainstHash,
  decideSignerAction,
  defaultExpiryAt,
  EnvelopeSpecError,
  hasDecline,
  isEnvelopeComplete,
  isExpired,
  nextSignerToAct,
  prepareSigners,
  reminderDates,
  type SignerSummary,
} from "./envelope";
import type { BusinessCalendar } from "@/core";

const CAL: BusinessCalendar = {
  timeZone: "America/Chicago",
  weekly: {
    mon: [{ start: "09:00", end: "17:00" }],
    tue: [{ start: "09:00", end: "17:00" }],
    wed: [{ start: "09:00", end: "17:00" }],
    thu: [{ start: "09:00", end: "17:00" }],
    fri: [{ start: "09:00", end: "17:00" }],
  },
  holidays: [],
};

// A Tuesday at 10am Central, safely inside business hours on every day of the week that follows.
const TUESDAY_10AM = new Date("2026-11-03T16:00:00.000Z");

function signer(orderNo: number, status: SignerSummary["status"]): SignerSummary {
  return { orderNo, status };
}

describe("nextSignerToAct / isEnvelopeComplete / hasDecline", () => {
  it("picks the lowest unsigned order", () => {
    const turn = nextSignerToAct([signer(0, "signed"), signer(1, "sent"), signer(2, "pending")]);
    expect(turn).toEqual(signer(1, "sent"));
  });

  it("returns null once everyone has signed", () => {
    expect(nextSignerToAct([signer(0, "signed"), signer(1, "signed")])).toBeNull();
    expect(isEnvelopeComplete([signer(0, "signed"), signer(1, "signed")])).toBe(true);
  });

  it("stops the chain dead on a decline — nobody after it is ever next", () => {
    const signers = [signer(0, "signed"), signer(1, "declined"), signer(2, "pending")];
    expect(nextSignerToAct(signers)).toBeNull();
    expect(hasDecline(signers)).toBe(true);
    expect(isEnvelopeComplete(signers)).toBe(false);
  });

  it("is not complete with zero signers", () => {
    expect(isEnvelopeComplete([])).toBe(false);
  });
});

describe("decideSignerAction", () => {
  const signers = [signer(0, "signed"), signer(1, "sent"), signer(2, "pending")];

  it("allows the signer whose turn it is", () => {
    expect(decideSignerAction({ envelopeStatus: "sent", signer: signer(1, "sent"), signers })).toEqual({ allowed: true });
  });

  it("refuses a signer acting out of turn", () => {
    const decision = decideSignerAction({ envelopeStatus: "sent", signer: signer(2, "pending"), signers });
    expect(decision.allowed).toBe(false);
  });

  it("refuses any action once the envelope is not 'sent'", () => {
    const decision = decideSignerAction({ envelopeStatus: "voided", signer: signer(1, "sent"), signers });
    expect(decision).toEqual({ allowed: false, reason: "Envelope is 'voided', not awaiting action." });
  });
});

describe("canCompleteAgainstHash", () => {
  it("matches only the exact hash the envelope was bound to", () => {
    expect(canCompleteAgainstHash("abc123", "abc123")).toBe(true);
    expect(canCompleteAgainstHash("abc123", "def456")).toBe(false);
  });
});

describe("defaultExpiryAt / reminderDates / isExpired", () => {
  it("defaults to 10 business days out", () => {
    const sentAt = TUESDAY_10AM;
    const expires = defaultExpiryAt(sentAt, CAL);
    // Tue + 10 business days (Mon-Fri calendar) = two full weeks later, same Tuesday.
    expect(expires.getTime()).toBeGreaterThan(sentAt.getTime());
    expect(isExpired(expires, expires)).toBe(true);
    expect(isExpired(sentAt, expires)).toBe(false);
  });

  it("schedules reminders after 2 and 5 business days by default, in order, before expiry", () => {
    const sentAt = TUESDAY_10AM;
    const [first, second] = reminderDates(sentAt, CAL);
    const expires = defaultExpiryAt(sentAt, CAL);
    expect(first!.getTime()).toBeLessThan(second!.getTime());
    expect(second!.getTime()).toBeLessThan(expires.getTime());
  });

  it("accepts a custom cadence", () => {
    const sentAt = TUESDAY_10AM;
    const dates = reminderDates(sentAt, CAL, [1]);
    expect(dates).toHaveLength(1);
  });
});

describe("prepareSigners", () => {
  it("numbers signers in the order given and fills the default identity method", () => {
    const prepared = prepareSigners([{ signerType: "client", partyId: "party-1" }, { signerType: "firm_user", userId: "user-1" }]);
    expect(prepared.map((s) => s.orderNo)).toEqual([0, 1]);
    expect(prepared[0]!.identityMethod).toBe("portal_login");
  });

  it("rejects an empty signer list", () => {
    expect(() => prepareSigners([])).toThrow(EnvelopeSpecError);
  });

  it("rejects a signer with neither partyId nor userId", () => {
    expect(() => prepareSigners([{ signerType: "client" }])).toThrow(EnvelopeSpecError);
  });

  it("rejects a signer with both partyId and userId", () => {
    expect(() => prepareSigners([{ signerType: "client", partyId: "p", userId: "u" }])).toThrow(EnvelopeSpecError);
  });

  it("honors an explicit identity method", () => {
    const prepared = prepareSigners([{ signerType: "client", partyId: "p", identityMethod: "one_time_code" }]);
    expect(prepared[0]!.identityMethod).toBe("one_time_code");
  });
});
