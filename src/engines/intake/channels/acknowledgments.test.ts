import { describe, it, expect } from "vitest";
import type { Gate, GateStatus } from "@/compliance/approvals";
import { buildAcknowledgmentRecord, summarizeDisclosureProof } from "./acknowledgments";

function gate(overrides: Partial<Gate> = {}): Gate {
  return {
    key: "copy.intake.channel_disclosure",
    description: "Intake disclosures shown on every channel before any case-detail question",
    draft: "You are contacting {firmName}...",
    reviewers: ["attorney"],
    cardIds: ["c65", "c72"],
    draftHash: "abc123ff00112233",
    ...overrides,
  };
}

function status(overrides: Partial<GateStatus> = {}): GateStatus {
  const g = overrides.gate ?? gate();
  return {
    gate: g,
    approved: false,
    pendingReviewers: ["attorney"],
    approvals: [],
    approvedText: null,
    ...overrides,
  };
}

describe("c72 buildAcknowledgmentRecord", () => {
  it("pins the gate's draft hash when the wording is approved", () => {
    const rec = buildAcknowledgmentRecord({
      consentType: "disclosures",
      channel: "web_chat",
      language: "en",
      given: true,
      gateStatus: status({ approved: true, pendingReviewers: [] }),
      now: new Date("2026-11-01T12:00:00Z"),
    });
    expect(rec).toEqual({
      consentType: "disclosures",
      channel: "web_chat",
      language: "en",
      given: true,
      textGateKey: "copy.intake.channel_disclosure",
      textVersion: "abc123ff00112233",
      givenAt: new Date("2026-11-01T12:00:00Z"),
    });
  });

  it("records 'pending_review' while the wording is not yet approved", () => {
    const rec = buildAcknowledgmentRecord({
      consentType: "sms",
      channel: "sms",
      language: "es",
      given: true,
      gateStatus: status({ gate: gate({ key: "copy.intake.sms_first_reply_es" }) }),
      now: new Date("2026-11-01T12:05:00Z"),
    });
    expect(rec.textGateKey).toBe("copy.intake.sms_first_reply_es");
    expect(rec.textVersion).toBe("pending_review");
    expect(rec.language).toBe("es");
  });

  it("falls back to 'approved' when an approved gate has no draft hash to pin", () => {
    const rec = buildAcknowledgmentRecord({
      consentType: "recording",
      channel: "phone_ai",
      language: "en",
      given: false,
      gateStatus: status({ approved: true, pendingReviewers: [], gate: gate({ draftHash: null }) }),
      now: new Date("2026-11-01T12:10:00Z"),
    });
    expect(rec.textVersion).toBe("approved");
    expect(rec.given).toBe(false);
  });
});

describe("c72 summarizeDisclosureProof", () => {
  const baseConsent = {
    consentType: "disclosures" as const,
    channel: "web_chat",
    language: "en",
    textGateKey: "copy.intake.channel_disclosure",
    textVersion: "hash1",
    given: true,
    withdrawnAt: null,
  };

  it("joins each acknowledgment with the nearest matching message at or before it", () => {
    const consents = [{ ...baseConsent, givenAt: new Date("2026-11-01T10:05:00Z") }];
    const messages = [
      { channel: "web_chat", copyGateKey: "copy.intake.channel_disclosure", body: "old pending placeholder", createdAt: new Date("2026-11-01T09:00:00Z") },
      { channel: "web_chat", copyGateKey: "copy.intake.channel_disclosure", body: "You are contacting Acme Law...", createdAt: new Date("2026-11-01T10:00:00Z") },
      { channel: "web_chat", copyGateKey: "copy.intake.channel_disclosure", body: "shown after the ack, must not match", createdAt: new Date("2026-11-01T10:30:00Z") },
      { channel: "sms", copyGateKey: "copy.intake.sms_first_reply", body: "unrelated gate", createdAt: new Date("2026-11-01T10:00:00Z") },
    ];
    const out = summarizeDisclosureProof(consents, messages);
    expect(out).toHaveLength(1);
    expect(out[0]!.textShown).toBe("You are contacting Acme Law...");
  });

  it("returns textShown null when no message matches the gate key (e.g. a staff-read script)", () => {
    const consents = [{ ...baseConsent, consentType: "disclosures" as const, channel: "walk_in", givenAt: new Date("2026-11-01T10:05:00Z") }];
    const out = summarizeDisclosureProof(consents, []);
    expect(out[0]!.textShown).toBeNull();
  });

  it("sorts entries oldest-first regardless of input order", () => {
    const consents = [
      { ...baseConsent, consentType: "recording" as const, givenAt: new Date("2026-11-01T11:00:00Z") },
      { ...baseConsent, consentType: "disclosures" as const, givenAt: new Date("2026-11-01T10:00:00Z") },
      { ...baseConsent, consentType: "sms" as const, givenAt: new Date("2026-11-01T10:30:00Z") },
    ];
    const out = summarizeDisclosureProof(consents, []);
    expect(out.map((e) => e.consentType)).toEqual(["disclosures", "sms", "recording"]);
  });

  it("carries given/withdrawn and language through untouched", () => {
    const consents = [{ ...baseConsent, consentType: "sms" as const, given: false, language: "es", withdrawnAt: new Date("2026-11-02T00:00:00Z"), givenAt: new Date("2026-11-01T10:00:00Z") }];
    const out = summarizeDisclosureProof(consents, []);
    expect(out[0]).toMatchObject({ given: false, language: "es", withdrawnAt: new Date("2026-11-02T00:00:00Z") });
  });
});
