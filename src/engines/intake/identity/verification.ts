// c71 — Intake engine · identity verification before sharing matter
// information: pure decision logic. The card's safety property is that a
// one-time code is only ever sent to a contact method ALREADY ON FILE for
// the party — never to whatever the caller is currently claiming. Checking
// that, generating/hashing a real code, and dispatching it through a vendor
// live in ./service.ts; this file is everything pure: resolving an on-file
// value, expiry, attempt limits, a constant-time code comparison, and the
// final allowed/blocked sharing decision.

import { normalizeEmail, normalizePhone } from "./matching";

export type VerificationChannel = "phone" | "sms" | "email";
export type VerificationMethod = "portal_login" | "one_time_code";
export type VerificationStatus = "pending" | "verified" | "failed" | "expired";

/** Defaults until firm settings cover this (see the implementation notes' follow-ups). */
export const DEFAULT_CODE_LENGTH = 6;
export const DEFAULT_CODE_EXPIRY_MINUTES = 10;
export const DEFAULT_MAX_ATTEMPTS = 5;
/** How long a completed verification keeps covering requests on the SAME channel + contact value. */
export const DEFAULT_VERIFICATION_FRESHNESS_MINUTES = 30;

export interface ContactOnFile {
  email?: string | null;
  phone?: string | null;
  emails?: readonly string[];
  phones?: readonly string[];
}

/**
 * c71's core safety check: is the contact value the caller is using one the
 * party already has on file? Returns the matching on-file value (normalised)
 * to send the code to, or null when it is not one of the party's known
 * contact points — in which case the caller is asked to prove identity a
 * different way instead of a code going to an address that might not be
 * theirs.
 */
export function resolveOnFileContactValue(
  channel: VerificationChannel,
  valueProvided: string,
  onFile: ContactOnFile
): string | null {
  if (channel === "email") {
    const normalized = normalizeEmail(valueProvided);
    const known = [onFile.email, ...(onFile.emails ?? [])].filter((e): e is string => !!e).map(normalizeEmail);
    return known.includes(normalized) ? normalized : null;
  }
  // 'phone' and 'sms' both verify against the same phone numbers on file —
  // which medium actually carries the code is a dispatch detail (service.ts).
  const normalized = normalizePhone(valueProvided);
  const known = [onFile.phone, ...(onFile.phones ?? [])].filter((p): p is string => !!p).map(normalizePhone);
  return normalized.length === 10 && known.includes(normalized) ? normalized : null;
}

/** Render a CSPRNG integer (service.ts uses node:crypto.randomInt) as a fixed-width numeric code, never losing a leading zero. */
export function formatCode(randomInt: number, length: number = DEFAULT_CODE_LENGTH): string {
  const max = 10 ** length;
  const n = ((randomInt % max) + max) % max;
  return String(n).padStart(length, "0");
}

export function codeExpiryAt(requestedAt: Date, minutes: number = DEFAULT_CODE_EXPIRY_MINUTES): Date {
  return new Date(requestedAt.getTime() + minutes * 60_000);
}

export function isCodeExpired(now: Date, expiresAt: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export interface AttemptCheck {
  status: VerificationStatus;
  attempts: number;
  maxAttempts: number;
  codeExpiresAt: Date | null;
  now: Date;
}

export type AttemptDecision = { allowed: true } | { allowed: false; reason: string };

/** May this verification even be checked right now (not already resolved, not expired, attempts left)? */
export function decideAttemptAllowed(check: AttemptCheck): AttemptDecision {
  if (check.status === "verified") return { allowed: false, reason: "Already verified." };
  if (check.status === "failed") return { allowed: false, reason: "Too many incorrect codes; request a new one." };
  if (check.status === "expired") return { allowed: false, reason: "Code expired; request a new one." };
  if (check.codeExpiresAt && isCodeExpired(check.now, check.codeExpiresAt)) {
    return { allowed: false, reason: "Code expired; request a new one." };
  }
  if (check.attempts >= check.maxAttempts) {
    return { allowed: false, reason: "Too many incorrect codes; request a new one." };
  }
  return { allowed: true };
}

/**
 * Constant-time string comparison (both strings are expected to be the same
 * fixed-length hash hex, so a length mismatch alone is not a useful signal)
 * so response timing cannot be used to recover the code one character at a
 * time.
 */
export function codesMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export interface PriorVerification {
  status: VerificationStatus;
  channel: VerificationChannel;
  contactValueUsed: string | null;
  verifiedAt: Date | null;
}

export interface SharingDecisionInput {
  channel: VerificationChannel;
  contactValueProvided: string;
  onFile: ContactOnFile;
  /** True when the party already authenticated via the client portal this session (c71: "portal login, or a one-time code ..."). */
  portalAuthenticated: boolean;
  /** The most recent verification row for this party, if any. */
  latest: PriorVerification | null;
  now: Date;
  freshnessMinutes?: number;
}

export type SharingDecision = { allowed: true } | { allowed: false; reason: string; requiredAction: "verify_identity" };

/**
 * c71's actual gate: may matter information be shared over this channel,
 * right now? Portal login always satisfies it. Otherwise a one-time code
 * must have been verified, on THIS SAME channel and the SAME on-file
 * contact value, and recently enough that it still counts — a code verified
 * yesterday should not quietly authorise today's call.
 */
export function decideInfoSharingAllowed(input: SharingDecisionInput): SharingDecision {
  if (input.portalAuthenticated) return { allowed: true };

  const onFileValue = resolveOnFileContactValue(input.channel, input.contactValueProvided, input.onFile);
  if (onFileValue === null) {
    return {
      allowed: false,
      reason: "The contact details given are not on file for this party; a code cannot be sent there.",
      requiredAction: "verify_identity",
    };
  }

  const freshness = input.freshnessMinutes ?? DEFAULT_VERIFICATION_FRESHNESS_MINUTES;
  const latest = input.latest;
  if (
    latest &&
    latest.status === "verified" &&
    latest.channel === input.channel &&
    latest.contactValueUsed === onFileValue &&
    latest.verifiedAt &&
    input.now.getTime() - latest.verifiedAt.getTime() <= freshness * 60_000
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "Identity has not been verified recently enough on this channel; send a new one-time code.",
    requiredAction: "verify_identity",
  };
}
