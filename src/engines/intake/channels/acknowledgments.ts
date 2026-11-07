// c72 — proof that disclosures and consent were shown and acknowledged.
//
// c65 already records, for every channel, the literal rendered text of each
// outbound disclosure/consent prompt (intake_messages.body, tagged with the
// copy gate key that produced it — see channels/service.ts's
// deliverReplies()/storeMessage()) and a timestamped acknowledgment of it
// (intake_consents: consent type, channel, language, the gate key, and the
// draft hash of the wording the person saw — see acknowledgeDisclosures()
// and recordConsent()). This module is the pure, testable glue between the
// two:
//  - buildAcknowledgmentRecord() computes the row to insert at the moment of
//    acknowledgment (factored out of channels/service.ts's
//    acknowledgeDisclosures() and recordConsent(), which previously
//    duplicated the same version-pinning logic inline);
//  - summarizeDisclosureProof() joins acknowledgments with the literal text
//    that produced them into one proof-of-disclosure report per session —
//    "each acknowledgment is stored with time, channel and the exact text
//    version shown, so the firm can prove what the person saw" (c72's
//    note). The wording itself is still pending attorney review
//    (src/engines/intake/gates.ts's CHANNEL_COPY): this module only proves
//    what was actually shown and agreed to, whatever that wording was at
//    the time it was shown.
//
// No database import here — see channels/service.ts for the DB-backed
// callers (acknowledgeDisclosures, recordConsent, getDisclosureProof).

import type { GateStatus } from "@/compliance/approvals";
import type { IntakeChannel } from "./records";

/** The distinct consent/acknowledgment moments c72's note calls for, plus the two already reserved in the intake_consents CHECK constraint. */
export const CONSENT_TYPES = ["disclosures", "recording", "sms", "ai_disclosure", "safe_contact"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export interface AcknowledgmentRecordInput {
  consentType: ConsentType;
  channel: IntakeChannel;
  /** 'en' | 'es' (c36) — the language of the wording actually shown. */
  language: string;
  given: boolean;
  /** gateStatus(key) for the exact gate the wording came from. */
  gateStatus: GateStatus;
  now: Date;
}

export interface AcknowledgmentRecord {
  consentType: ConsentType;
  channel: IntakeChannel;
  language: string;
  given: boolean;
  textGateKey: string;
  /**
   * The draft hash of the wording shown, pinned at the moment of
   * acknowledgment: if a reviewer later edits the draft (the gate re-closes
   * automatically, per src/compliance/approvals.ts), this hash still points
   * at the exact text that was in front of the person, not whatever is
   * approved today. 'approved' / 'pending_review' only when the gate has no
   * draft to hash (not expected for the copy gates this module serves, but
   * kept as a safe fallback rather than throwing).
   */
  textVersion: string;
  givenAt: Date;
}

/** Build the intake_consents row for one acknowledgment (pure). */
export function buildAcknowledgmentRecord(input: AcknowledgmentRecordInput): AcknowledgmentRecord {
  const { gate, approved } = input.gateStatus;
  const textVersion = approved ? gate.draftHash ?? "approved" : "pending_review";
  return {
    consentType: input.consentType,
    channel: input.channel,
    language: input.language,
    given: input.given,
    textGateKey: gate.key,
    textVersion,
    givenAt: input.now,
  };
}

export interface DisclosureProofMessage {
  channel: string;
  copyGateKey: string | null;
  body: string;
  createdAt: Date;
}

export interface DisclosureProofConsent {
  consentType: ConsentType;
  channel: string;
  language: string | null;
  textGateKey: string | null;
  textVersion: string | null;
  given: boolean;
  givenAt: Date;
  withdrawnAt: Date | null;
}

export interface DisclosureProofEntry {
  consentType: ConsentType;
  given: boolean;
  givenAt: Date;
  withdrawnAt: Date | null;
  channel: string;
  language: string | null;
  gateKey: string | null;
  textVersion: string | null;
  /**
   * The literal text shown for this gate key, the most recent outbound
   * message at or before the acknowledgment. Null when no matching message
   * was found (e.g. a staff-read script on a staff-entered channel, where
   * the disclosure is read aloud rather than sent as a message).
   */
  textShown: string | null;
}

/**
 * One proof-of-disclosure report for a session, oldest acknowledgment
 * first: each consent joined with the literal outbound text (matched by
 * gate key, the message at or immediately before the acknowledgment) that
 * produced it. Pure — see getDisclosureProof() in channels/service.ts for
 * the DB-backed caller that fetches `consents` and `messages`.
 */
export function summarizeDisclosureProof(
  consents: readonly DisclosureProofConsent[],
  messages: readonly DisclosureProofMessage[]
): DisclosureProofEntry[] {
  return consents
    .slice()
    .sort((a, b) => a.givenAt.getTime() - b.givenAt.getTime())
    .map((c) => {
      const shown = messages
        .filter((m) => m.copyGateKey === c.textGateKey && m.createdAt.getTime() <= c.givenAt.getTime())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return {
        consentType: c.consentType,
        given: c.given,
        givenAt: c.givenAt,
        withdrawnAt: c.withdrawnAt,
        channel: c.channel,
        language: c.language,
        gateKey: c.textGateKey,
        textVersion: c.textVersion,
        textShown: shown?.body ?? null,
      };
    });
}
