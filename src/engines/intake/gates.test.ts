import { afterEach, describe, it, expect } from "vitest";
import { gateStatus, getGate, isPlaceholder, legalCopy, requireApproval, PendingApprovalError, resetApprovalStateForTests } from "@/compliance/approvals";
import { approveGates } from "./__tests__/fixtures";
import {
  ACCEPTANCE_GATES,
  BOOKING_COPY,
  BOOKING_RULE_GATES,
  CHANNEL_COPY,
  CLIENT_STATUS_GATES,
  copyKeyFor,
  FOLLOW_UP_GATES,
  FOLLOW_UP_TEMPLATES,
  INTAKE_GATE_KEYS,
  INTAKE_SHARED_GATE_KEYS,
  normalizeIntakeLanguage,
  OPEN_MATTER_GATES,
} from "./gates";

afterEach(() => resetApprovalStateForTests());

describe("intake approval gates", () => {
  it("every gate is defined, namespaced and unique", () => {
    expect(new Set(INTAKE_GATE_KEYS).size).toBe(INTAKE_GATE_KEYS.length);
    for (const key of [...INTAKE_GATE_KEYS, ...INTAKE_SHARED_GATE_KEYS]) {
      expect(() => getGate(key)).not.toThrow();
      expect(key).toMatch(/^(copy\.intake|rules\.intake|vendor\.|rules\.|notify\.)/);
    }
  });

  it("client wording is a visible placeholder until an attorney approves it", () => {
    const text = legalCopy(CHANNEL_COPY.disclosure.en.key, { firmName: "Smith Family Law", portalUrl: "https://x" });
    expect(isPlaceholder(text)).toBe(true);
    expect(text).toMatch(/PENDING ATTORNEY REVIEW/);
    approveGates(CHANNEL_COPY.disclosure.en.key);
    expect(legalCopy(CHANNEL_COPY.disclosure.en.key, { firmName: "Smith Family Law", portalUrl: "https://x" })).toMatch(/You are contacting Smith Family Law/);
  });

  it("Spanish twins exist for bilingual copy", () => {
    expect(copyKeyFor(CHANNEL_COPY.disclosure, "es")).toBe("copy.intake.channel_disclosure_es");
    expect(copyKeyFor(CHANNEL_COPY.disclosure, "en")).toBe("copy.intake.channel_disclosure");
  });

  it("trust / fee / open-matter rules need the right reviewers and fail safe", () => {
    expect(getGate(BOOKING_RULE_GATES.consultFeeTerms.key).reviewers).toEqual(["attorney", "cpa"]);
    expect(getGate(OPEN_MATTER_GATES.retainerAttestation.key).reviewers).toEqual(["attorney", "cpa"]);
    expect(getGate(ACCEPTANCE_GATES.autoDecline.key).reviewers).toEqual(["attorney", "founder_decision"]);
    expect(() => requireApproval(OPEN_MATTER_GATES.openGates.key, { action: "test" })).toThrow(PendingApprovalError);
    expect(gateStatus(OPEN_MATTER_GATES.openGates.key).pendingReviewers).toEqual(["attorney"]);
  });

  // c36 — every client-facing copy item English wording already required
  // attorney review for now carries the identical requirement for its
  // Spanish twin, with its own draft (never a hard-coded "approved"
  // translation) and its own gate key.
  describe("c36 — bilingual coverage reaches every client-facing copy item, not just the channel/emergency layer", () => {
    it("booking copy (confirmation, reminder, changed, rebook, follow-up-later) has an attorney-gated Spanish twin", () => {
      for (const gate of Object.values(BOOKING_COPY)) {
        expect(gate.es.key).toBe(`${gate.en.key}_es`);
        expect(getGate(gate.es.key).reviewers).toEqual(["attorney"]);
        expect(isPlaceholder(legalCopy(gate.es.key))).toBe(true);
      }
    });

    it("the matter-opened / portal-invite emails have a Spanish twin; the rule gates they sit beside do not need one", () => {
      expect(copyKeyFor(OPEN_MATTER_GATES.matterOpened, "es")).toBe("copy.intake.matter_opened_es");
      expect(copyKeyFor(OPEN_MATTER_GATES.portalInvite, "es")).toBe("copy.intake.portal_invite_es");
      // Rule-only gates (no client-facing draft) are untouched by c36.
      expect("en" in OPEN_MATTER_GATES.openGates).toBe(false);
    });

    it("every follow-up template and the stop confirmation have a Spanish twin", () => {
      for (const gate of [...Object.values(FOLLOW_UP_TEMPLATES), FOLLOW_UP_GATES.stopConfirmation]) {
        expect(copyKeyFor(gate, "es")).toBe(`${gate.en.key}_es`);
        expect(getGate(copyKeyFor(gate, "es")).reviewers).toEqual(["attorney"]);
      }
    });

    it("the non-engagement decline notice has a Spanish twin", () => {
      expect(copyKeyFor(ACCEPTANCE_GATES.declineNotice, "es")).toBe("copy.intake.decline_notice_es");
    });

    it("every generic client-status message (one per pipeline system stage) has a Spanish twin", () => {
      for (const [stage, gate] of Object.entries(CLIENT_STATUS_GATES)) {
        expect(copyKeyFor(gate, "es")).toBe(`copy.intake.client_status.${stage}_es`);
        expect(copyKeyFor(gate, "en")).toBe(`copy.intake.client_status.${stage}`);
      }
    });

    it("approving only the English twin leaves the Spanish one pending, and vice versa", () => {
      approveGates(BOOKING_COPY.confirmation.en.key);
      expect(isPlaceholder(legalCopy(BOOKING_COPY.confirmation.en.key))).toBe(false);
      expect(isPlaceholder(legalCopy(BOOKING_COPY.confirmation.es.key))).toBe(true);
    });
  });
});

describe("c36 — normalizeIntakeLanguage (pure locale selection)", () => {
  it("recognises 'es' case- and whitespace-insensitively", () => {
    expect(normalizeIntakeLanguage("es")).toBe("es");
    expect(normalizeIntakeLanguage("ES")).toBe("es");
    expect(normalizeIntakeLanguage(" es ")).toBe("es");
  });

  it("defaults everything else to 'en', including unsupported locales", () => {
    expect(normalizeIntakeLanguage("en")).toBe("en");
    expect(normalizeIntakeLanguage(null)).toBe("en");
    expect(normalizeIntakeLanguage(undefined)).toBe("en");
    expect(normalizeIntakeLanguage("")).toBe("en");
    expect(normalizeIntakeLanguage("fr")).toBe("en");
    expect(normalizeIntakeLanguage(42)).toBe("en");
  });

  it("copyKeyFor and normalizeIntakeLanguage agree on every input", () => {
    for (const input of ["es", "ES", " es ", "en", "fr", null, undefined, 42]) {
      const direct = normalizeIntakeLanguage(input);
      const viaCopyKey = copyKeyFor(CHANNEL_COPY.disclosure, input as string | null | undefined) === CHANNEL_COPY.disclosure.es.key ? "es" : "en";
      expect(viaCopyKey).toBe(direct);
    }
  });
});
