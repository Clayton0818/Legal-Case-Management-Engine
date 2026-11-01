// c4 — Document engine · e-signature envelope: pure decision logic.
//
// The envelope capability c39 (engagement agreement), c41 (pre-filing
// sign-off upgrade path), c59 (conflict waivers) and c52 (changed fee
// arrangements) all send through, once a vendor is wired in. This file is
// everything about an envelope that is pure data-in, data-out: signing
// order, hash binding, expiry and reminder scheduling. No DB, no vendor —
// those live in ./service.ts and the adapter seam it defines.

import { addBusinessDays, type BusinessCalendar } from "@/core";

export const ENVELOPE_PURPOSES = ["engagement", "waiver", "pre_filing", "fee_change", "other"] as const;
export type EnvelopePurpose = (typeof ENVELOPE_PURPOSES)[number];

export const ENVELOPE_STATUSES = ["draft", "sent", "completed", "declined", "expired", "voided"] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

export const SIGNER_STATUSES = ["pending", "sent", "viewed", "signed", "declined"] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];

export const SIGNER_TYPES = ["client", "firm_user", "other"] as const;
export type SignerType = (typeof SIGNER_TYPES)[number];

export const IDENTITY_METHODS = ["portal_login", "one_time_code", "email_link_only"] as const;
export type IdentityMethod = (typeof IDENTITY_METHODS)[number];

/** Spec §5 rule 6/7 defaults — firm settings in the real build, hard-coded here until that lands. */
export const DEFAULT_ENVELOPE_EXPIRY_BUSINESS_DAYS = 10;
export const DEFAULT_REMINDER_AFTER_BUSINESS_DAYS: readonly number[] = [2, 5];

export interface SignerSummary {
  orderNo: number;
  status: SignerStatus;
}

/**
 * Whose turn it is to act, in order (spec §4 "Send for signature", step 1 —
 * signers act in the order the sender set). A decline stops the chain dead:
 * nobody after a decline is ever "next". Returns null once everyone has
 * signed, or once a decline has happened.
 */
export function nextSignerToAct(signers: readonly SignerSummary[]): SignerSummary | null {
  const sorted = [...signers].sort((a, b) => a.orderNo - b.orderNo);
  for (const s of sorted) {
    if (s.status === "declined") return null;
    if (s.status !== "signed") return s;
  }
  return null;
}

/** True once every signer has signed (and there is at least one signer). */
export function isEnvelopeComplete(signers: readonly SignerSummary[]): boolean {
  return signers.length > 0 && signers.every((s) => s.status === "signed");
}

export function hasDecline(signers: readonly SignerSummary[]): boolean {
  return signers.some((s) => s.status === "declined");
}

export interface SignerActionCheck {
  envelopeStatus: EnvelopeStatus;
  signer: SignerSummary;
  signers: readonly SignerSummary[];
}

export type SignerActionDecision = { allowed: true } | { allowed: false; reason: string };

/** Pure: may this signer act (view/sign/decline) right now? Enforces envelope state + signing order. */
export function decideSignerAction(check: SignerActionCheck): SignerActionDecision {
  if (check.envelopeStatus !== "sent") {
    return { allowed: false, reason: `Envelope is '${check.envelopeStatus}', not awaiting action.` };
  }
  const turn = nextSignerToAct(check.signers);
  if (!turn || turn.orderNo !== check.signer.orderNo) {
    return { allowed: false, reason: "It is not this signer's turn yet." };
  }
  return { allowed: true };
}

/**
 * Business rule 1: an envelope is bound to one document version's hash.
 * Acceptance criterion 3 — if the document changes (a new version's hash),
 * the envelope can never complete against it; the caller must void and send
 * a new envelope instead.
 */
export function canCompleteAgainstHash(envelopeDocumentSha256: string, currentDocumentSha256: string): boolean {
  return envelopeDocumentSha256 === currentDocumentSha256;
}

/** Spec §5 rule 6: default expiry, a firm-set number of business days after sending. */
export function defaultExpiryAt(
  sentAt: Date,
  cal: BusinessCalendar,
  businessDays: number = DEFAULT_ENVELOPE_EXPIRY_BUSINESS_DAYS
): Date {
  return addBusinessDays(sentAt, businessDays, cal);
}

/** Spec §5 rule 7: reminder cadence after sending, before the task goes overdue. */
export function reminderDates(
  sentAt: Date,
  cal: BusinessCalendar,
  afterBusinessDays: readonly number[] = DEFAULT_REMINDER_AFTER_BUSINESS_DAYS
): Date[] {
  return afterBusinessDays.map((days) => addBusinessDays(sentAt, days, cal));
}

/** Pure: has this envelope's expiry passed? */
export function isExpired(now: Date, expiresAt: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** Pure: build the ordered signer rows for a new envelope, validating the shape the caller handed in. */
export interface NewSignerSpec {
  signerType: SignerType;
  partyId?: string | null;
  userId?: string | null;
  identityMethod?: IdentityMethod;
}

export interface PreparedSigner extends NewSignerSpec {
  orderNo: number;
  identityMethod: IdentityMethod;
}

export class EnvelopeSpecError extends Error {}

/**
 * Validate and number a signer list before it is inserted: at least one
 * signer, each with exactly one of partyId/userId (spec §6), in the order
 * the caller supplied them.
 */
export function prepareSigners(specs: readonly NewSignerSpec[], defaultIdentityMethod: IdentityMethod = "portal_login"): PreparedSigner[] {
  if (specs.length === 0) throw new EnvelopeSpecError("An envelope needs at least one signer.");
  return specs.map((spec, orderNo) => {
    const hasParty = spec.partyId != null;
    const hasUser = spec.userId != null;
    if (hasParty === hasUser) {
      throw new EnvelopeSpecError(`Signer ${orderNo}: exactly one of partyId or userId is required.`);
    }
    return { ...spec, orderNo, identityMethod: spec.identityMethod ?? defaultIdentityMethod };
  });
}
