import { describe, expect, it } from "vitest";
import {
  codeExpiryAt,
  codesMatch,
  decideAttemptAllowed,
  decideInfoSharingAllowed,
  formatCode,
  isCodeExpired,
  resolveOnFileContactValue,
  type ContactOnFile,
  type PriorVerification,
} from "./verification";

const NOW = new Date("2026-11-03T16:00:00.000Z");

describe("resolveOnFileContactValue", () => {
  const onFile: ContactOnFile = { email: "jane@example.com", phone: "512-555-0100", emails: ["jane.alt@example.com"], phones: ["512-555-0199"] };

  it("matches the primary email, normalised", () => {
    expect(resolveOnFileContactValue("email", " Jane@Example.com ", onFile)).toBe("jane@example.com");
  });

  it("matches a secondary email too", () => {
    expect(resolveOnFileContactValue("email", "jane.alt@example.com", onFile)).toBe("jane.alt@example.com");
  });

  it("returns null for an email not on file", () => {
    expect(resolveOnFileContactValue("email", "attacker@example.com", onFile)).toBeNull();
  });

  it("matches a phone number regardless of formatting, for both 'phone' and 'sms' channels", () => {
    expect(resolveOnFileContactValue("phone", "(512) 555-0100", onFile)).toBe("5125550100");
    expect(resolveOnFileContactValue("sms", "+1 512-555-0100", onFile)).toBe("5125550100");
  });

  it("matches a secondary phone", () => {
    expect(resolveOnFileContactValue("sms", "5125550199", onFile)).toBe("5125550199");
  });

  it("returns null for a phone not on file", () => {
    expect(resolveOnFileContactValue("phone", "512-555-9999", onFile)).toBeNull();
  });

  it("never matches an empty on-file record", () => {
    expect(resolveOnFileContactValue("email", "jane@example.com", {})).toBeNull();
    expect(resolveOnFileContactValue("phone", "512-555-0100", {})).toBeNull();
  });
});

describe("formatCode / codeExpiryAt / isCodeExpired", () => {
  it("always returns a fixed-width numeric string, padding leading zeros", () => {
    expect(formatCode(7)).toBe("000007");
    expect(formatCode(42, 4)).toBe("0042");
  });

  it("wraps a value larger than the width down into range", () => {
    expect(formatCode(1_000_007)).toBe("000007");
  });

  it("handles a negative randomInt without throwing or going negative", () => {
    const code = formatCode(-3);
    expect(code).toHaveLength(6);
    expect(Number(code)).toBeGreaterThanOrEqual(0);
  });

  it("expires 10 minutes after request by default", () => {
    const expiresAt = codeExpiryAt(NOW);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(10 * 60_000);
    expect(isCodeExpired(expiresAt, expiresAt)).toBe(true);
    expect(isCodeExpired(NOW, expiresAt)).toBe(false);
  });

  it("accepts a custom expiry window", () => {
    const expiresAt = codeExpiryAt(NOW, 2);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(2 * 60_000);
  });
});

describe("decideAttemptAllowed", () => {
  const base = { status: "pending" as const, attempts: 0, maxAttempts: 5, codeExpiresAt: new Date(NOW.getTime() + 60_000), now: NOW };

  it("allows a fresh attempt", () => {
    expect(decideAttemptAllowed(base)).toEqual({ allowed: true });
  });

  it("refuses once already verified", () => {
    expect(decideAttemptAllowed({ ...base, status: "verified" }).allowed).toBe(false);
  });

  it("refuses once marked failed", () => {
    expect(decideAttemptAllowed({ ...base, status: "failed" }).allowed).toBe(false);
  });

  it("refuses an expired code even if attempts remain", () => {
    const decision = decideAttemptAllowed({ ...base, codeExpiresAt: new Date(NOW.getTime() - 1) });
    expect(decision).toEqual({ allowed: false, reason: "Code expired; request a new one." });
  });

  it("refuses once attempts are exhausted", () => {
    const decision = decideAttemptAllowed({ ...base, attempts: 5 });
    expect(decision.allowed).toBe(false);
  });
});

describe("codesMatch", () => {
  it("matches identical strings", () => {
    expect(codesMatch("abcdef", "abcdef")).toBe(true);
  });

  it("rejects a single differing character", () => {
    expect(codesMatch("abcdef", "abcdeg")).toBe(false);
  });

  it("rejects a length mismatch instead of throwing", () => {
    expect(codesMatch("abc", "abcd")).toBe(false);
  });
});

describe("decideInfoSharingAllowed", () => {
  const onFile: ContactOnFile = { email: "jane@example.com", phone: "512-555-0100" };

  it("allows sharing once the party is portal-authenticated, with no code needed", () => {
    const decision = decideInfoSharingAllowed({
      channel: "email",
      contactValueProvided: "jane@example.com",
      onFile,
      portalAuthenticated: true,
      latest: null,
      now: NOW,
    });
    expect(decision).toEqual({ allowed: true });
  });

  it("blocks when the caller's contact value is not on file, before even looking at verification history", () => {
    const decision = decideInfoSharingAllowed({
      channel: "phone",
      contactValueProvided: "512-555-9999",
      onFile,
      portalAuthenticated: false,
      latest: null,
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.requiredAction).toBe("verify_identity");
      expect(decision.reason).toMatch(/not on file/);
    }
  });

  it("allows sharing when a code was verified on the same channel and contact value recently", () => {
    const latest: PriorVerification = { status: "verified", channel: "sms", contactValueUsed: "5125550100", verifiedAt: new Date(NOW.getTime() - 5 * 60_000) };
    const decision = decideInfoSharingAllowed({
      channel: "sms",
      contactValueProvided: "512-555-0100",
      onFile,
      portalAuthenticated: false,
      latest,
      now: NOW,
    });
    expect(decision).toEqual({ allowed: true });
  });

  it("blocks when the verified code has gone stale", () => {
    const latest: PriorVerification = { status: "verified", channel: "sms", contactValueUsed: "5125550100", verifiedAt: new Date(NOW.getTime() - 60 * 60_000) };
    const decision = decideInfoSharingAllowed({
      channel: "sms",
      contactValueProvided: "512-555-0100",
      onFile,
      portalAuthenticated: false,
      latest,
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
  });

  it("does not let a code verified on email cover a phone call", () => {
    const latest: PriorVerification = { status: "verified", channel: "email", contactValueUsed: "jane@example.com", verifiedAt: NOW };
    const decision = decideInfoSharingAllowed({
      channel: "phone",
      contactValueProvided: "512-555-0100",
      onFile,
      portalAuthenticated: false,
      latest,
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
  });
});
