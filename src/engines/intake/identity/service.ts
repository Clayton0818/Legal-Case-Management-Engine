// c71 — Intake engine · spot repeat contacts and verify identity before
// sharing anything. This is the FIRST code slice: detect likely-duplicate
// parties and queue them as staff-reviewable suggestions (never auto-merge),
// let staff confirm or reject one, and gate sharing matter information on
// portal login or a one-time code sent to a contact method already on file.
//
// NOT in this slice (see the PR description's "not done here"): routes and
// staff/admin UI; a real SMS/email vendor adapter (the dispatch seam below
// fails closed exactly like c4's EnvelopeDispatchAdapter); wiring this into
// src/core/notify.ts's enqueueNotification (its payload is ids-only today —
// a one-time code is secret, one-off content that path was not built to
// carry, so this file dispatches directly through its own adapter seam
// instead); firm-settings-driven code length/expiry/attempt caps (hard-coded
// below, same approach c4's envelope.ts took for expiry/reminder defaults);
// a normalized-phone column on `parties` for a tighter SQL prefilter (see
// the comment on findDuplicateCandidates).

import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { parties } from "@/db/schema";
import { intakeContactMatchSuggestions, intakeIdentityVerifications, intakeSessionState } from "@/db/tables/intake";
import { audit, auditBlocked, type Actor } from "@/core";
import { legalCopy, requireApproval, runGated } from "@/compliance/approvals";
import type { TenantTx } from "@/tenancy/withTenant";
import { IntakeNotFoundError, IntakeRuleError, requireReason } from "../common/errors";
import { requireStaff, userActor, STAFF_ROLES } from "../common/actors";
import { INTAKE_ENGINE } from "../settings";
import { IDENTITY_COPY, VENDOR_GATES } from "../gates";
import { findCandidateMatches, type CandidateParty, type MatchResult, type NewContact } from "./matching";
import {
  codeExpiryAt,
  codesMatch,
  decideAttemptAllowed,
  decideInfoSharingAllowed,
  formatCode,
  resolveOnFileContactValue,
  DEFAULT_CODE_EXPIRY_MINUTES,
  DEFAULT_CODE_LENGTH,
  DEFAULT_MAX_ATTEMPTS,
  type ContactOnFile,
  type PriorVerification,
  type SharingDecision,
  type VerificationChannel,
} from "./verification";

interface IdentityCtx {
  tenantId: string;
  now?: Date;
}

/** How many of the tenant's most-recently-touched parties to scan per lookup. See findDuplicateCandidates. */
const MAX_CANDIDATE_SCAN = 1000;

function hashCode(code: string, salt: string): string {
  return createHash("sha256").update(`${code}:${salt}`).digest("hex");
}

async function loadParty(tx: TenantTx, tenantId: string, partyId: string) {
  const [row] = await tx
    .select()
    .from(parties)
    .where(and(eq(parties.tenantId, tenantId), eq(parties.id, partyId)))
    .limit(1);
  if (!row) throw new IntakeNotFoundError("Party");
  return row;
}

function toOnFile(party: typeof parties.$inferSelect): ContactOnFile {
  return { email: party.email, phone: party.phone, emails: party.emails, phones: party.phones };
}

// ---------------------------------------------------------------------------
// Duplicate detection (never auto-merges — only ever queues a suggestion)
// ---------------------------------------------------------------------------

export interface FindDuplicatesInput {
  intakeSessionId: string;
  incoming: NewContact;
}

export interface FindDuplicatesResult {
  matches: MatchResult[];
  suggestionsCreated: number;
}

/**
 * Score the tenant's existing parties against a newly-arriving contact and
 * queue any match above 'none' as a suggestion for staff to confirm or
 * reject (c65 acceptance criterion 4; c71: never auto-merge).
 *
 * The SQL side is deliberately simple for this first slice: it scans the
 * tenant's `MAX_CANDIDATE_SCAN` most recently touched parties and lets the
 * pure scorer (./matching.ts) do the real comparison, rather than trying to
 * express fuzzy name/phone matching in SQL. `parties.phone` is not stored in
 * a normalised column today, so a tighter, indexed SQL prefilter (matching
 * on a `normalizedPhone` column) is a follow-up once that column exists.
 */
export async function findDuplicateCandidates(
  tx: TenantTx,
  ctx: IdentityCtx,
  input: FindDuplicatesInput
): Promise<FindDuplicatesResult> {
  const rows = await tx
    .select()
    .from(parties)
    .where(eq(parties.tenantId, ctx.tenantId))
    .orderBy(desc(parties.updatedAt))
    .limit(MAX_CANDIDATE_SCAN);

  const candidates: CandidateParty[] = rows.map((p) => ({
    partyId: p.id,
    fullName: p.fullName,
    normalizedName: p.normalizedName,
    email: p.email,
    phone: p.phone,
    dateOfBirth: p.dateOfBirth,
    aliases: p.aliases,
    normalizedAliases: p.normalizedAliases,
    emails: p.emails,
    phones: p.phones,
  }));

  const matches = findCandidateMatches(input.incoming, candidates);
  if (matches.length === 0) return { matches, suggestionsCreated: 0 };

  const now = ctx.now ?? new Date();
  const inserted = await tx
    .insert(intakeContactMatchSuggestions)
    .values(
      matches.map((m) => ({
        tenantId: ctx.tenantId,
        intakeSessionId: input.intakeSessionId,
        matchedPartyId: m.partyId,
        confidence: m.confidence,
        matchedFields: m.matchedFields,
        score: m.score,
        status: "pending" as const,
        createdAt: now,
      }))
    )
    // A suggestion for this (session, party) pair already exists — leave whatever staff
    // already decided (or the still-pending row) alone rather than reopening it.
    .onConflictDoNothing()
    .returning({ id: intakeContactMatchSuggestions.id });

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: INTAKE_ENGINE,
    action: "intake.identity.duplicates_found",
    entityType: "intake_session",
    entityId: input.intakeSessionId,
    intakeSessionId: input.intakeSessionId,
    payload: { matchCount: matches.length, suggestionsCreated: inserted.length },
  });

  return { matches, suggestionsCreated: inserted.length };
}

async function loadSuggestion(tx: TenantTx, tenantId: string, suggestionId: string) {
  const [row] = await tx
    .select()
    .from(intakeContactMatchSuggestions)
    .where(and(eq(intakeContactMatchSuggestions.tenantId, tenantId), eq(intakeContactMatchSuggestions.id, suggestionId)))
    .limit(1);
  if (!row) throw new IntakeNotFoundError("Contact match suggestion");
  return row;
}

/** Staff confirms a suggested link: the session's party pointer moves to the existing party. Nothing about the `parties` rows themselves changes. */
export async function confirmMatch(
  tx: TenantTx,
  ctx: IdentityCtx,
  input: { suggestionId: string; byUserId: string }
): Promise<void> {
  await requireStaff(tx, ctx.tenantId, input.byUserId, STAFF_ROLES, "confirm a repeat-contact match");
  const suggestion = await loadSuggestion(tx, ctx.tenantId, input.suggestionId);
  if (suggestion.status !== "pending") {
    throw new IntakeRuleError(`This suggestion is already '${suggestion.status}'.`);
  }
  const now = ctx.now ?? new Date();

  await tx
    .update(intakeContactMatchSuggestions)
    .set({ status: "confirmed", reviewedByUserId: input.byUserId, reviewedAt: now })
    .where(eq(intakeContactMatchSuggestions.id, suggestion.id));

  await tx
    .update(intakeSessionState)
    .set({ partyId: suggestion.matchedPartyId, updatedAt: now })
    .where(and(eq(intakeSessionState.tenantId, ctx.tenantId), eq(intakeSessionState.intakeSessionId, suggestion.intakeSessionId)));

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: INTAKE_ENGINE,
    action: "intake.identity.match_confirmed",
    entityType: "intake_contact_match_suggestion",
    entityId: suggestion.id,
    intakeSessionId: suggestion.intakeSessionId,
    actor: userActor(input.byUserId),
    payload: { matchedPartyId: suggestion.matchedPartyId, confidence: suggestion.confidence },
  });
}

/** Staff rejects a suggestion: these are two different people. Requires a reason (no silent dismissals). */
export async function rejectMatch(
  tx: TenantTx,
  ctx: IdentityCtx,
  input: { suggestionId: string; byUserId: string; reason: string }
): Promise<void> {
  await requireStaff(tx, ctx.tenantId, input.byUserId, STAFF_ROLES, "reject a repeat-contact match");
  const reason = requireReason(input.reason, "Rejecting a repeat-contact match");
  const suggestion = await loadSuggestion(tx, ctx.tenantId, input.suggestionId);
  if (suggestion.status !== "pending") {
    throw new IntakeRuleError(`This suggestion is already '${suggestion.status}'.`);
  }
  const now = ctx.now ?? new Date();

  await tx
    .update(intakeContactMatchSuggestions)
    .set({ status: "rejected", reviewedByUserId: input.byUserId, reviewedAt: now, rejectedReason: reason })
    .where(eq(intakeContactMatchSuggestions.id, suggestion.id));

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: INTAKE_ENGINE,
    action: "intake.identity.match_rejected",
    entityType: "intake_contact_match_suggestion",
    entityId: suggestion.id,
    intakeSessionId: suggestion.intakeSessionId,
    actor: userActor(input.byUserId),
    reason,
    payload: { matchedPartyId: suggestion.matchedPartyId },
  });
}

// ---------------------------------------------------------------------------
// One-time-code dispatch adapter seam (for a real SMS/email vendor to fill
// in later — mirrors c4's EnvelopeDispatchAdapter / UnavailableEnvelopeAdapter).
// ---------------------------------------------------------------------------

export interface OtpDispatchAdapter {
  readonly name: string;
  dispatch(input: { tenantId: string; medium: "sms" | "email"; contactValue: string; text: string }): Promise<void>;
}

/** No vendor is wired yet: every call fails closed through vendor.sms / vendor.email. */
export class UnavailableOtpAdapter implements OtpDispatchAdapter {
  readonly name = "unavailable";
  async dispatch(input: { tenantId: string; medium: "sms" | "email" }): Promise<void> {
    const gateKey = input.medium === "email" ? VENDOR_GATES.email.key : VENDOR_GATES.sms.key;
    requireApproval(gateKey, { action: "intake.identity.send_code", tenantId: input.tenantId });
    // requireApproval always throws while the gate is pending; reachable only
    // once a real adapter is swapped in with setOtpAdapter().
    throw new Error("UnavailableOtpAdapter: no SMS/email vendor configured.");
  }
}

let otpAdapter: OtpDispatchAdapter = new UnavailableOtpAdapter();

export function setOtpAdapter(next: OtpDispatchAdapter | null): void {
  otpAdapter = next ?? new UnavailableOtpAdapter();
}

export function getOtpAdapter(): OtpDispatchAdapter {
  return otpAdapter;
}

// ---------------------------------------------------------------------------
// Request / verify a one-time code
// ---------------------------------------------------------------------------

export interface RequestCodeInput {
  partyId: string;
  intakeSessionId?: string | null;
  channel: VerificationChannel;
  /** What the caller is CURRENTLY stating (a phone number or email) — checked against what is on file, never trusted on its own. */
  contactValueProvided: string;
  firmName: string;
  /** Staff triggering this from the console; omitted when the automated channel (AI) requests it on the caller's behalf. */
  requestedByUserId?: string | null;
}

export type RequestCodeResult =
  | { status: "sent"; verificationId: string; codeExpiresAt: Date }
  | { status: "blocked_pending_vendor"; verificationId: string; placeholder: string };

/** Send a one-time code — but only to a contact value the party already has on file (c71's core safety property). */
export async function requestVerificationCode(tx: TenantTx, ctx: IdentityCtx, input: RequestCodeInput): Promise<RequestCodeResult> {
  if (input.requestedByUserId) {
    await requireStaff(tx, ctx.tenantId, input.requestedByUserId, STAFF_ROLES, "send an identity verification code");
  }
  const party = await loadParty(tx, ctx.tenantId, input.partyId);
  const onFile = toOnFile(party);
  const onFileValue = resolveOnFileContactValue(input.channel, input.contactValueProvided, onFile);
  if (onFileValue === null) {
    throw new IntakeRuleError("The contact details given are not on file for this party; a code cannot be sent there.", {
      channel: input.channel,
    });
  }

  const now = ctx.now ?? new Date();
  const code = formatCode(randomInt(0, 10 ** DEFAULT_CODE_LENGTH));
  const salt = randomBytes(16).toString("hex");
  const expiresAt = codeExpiryAt(now, DEFAULT_CODE_EXPIRY_MINUTES);

  const [verification] = await tx
    .insert(intakeIdentityVerifications)
    .values({
      tenantId: ctx.tenantId,
      partyId: party.id,
      intakeSessionId: input.intakeSessionId ?? null,
      channel: input.channel,
      method: "one_time_code",
      contactValueUsed: onFileValue,
      codeHash: hashCode(code, salt),
      codeSalt: salt,
      status: "pending",
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      requestedAt: now,
      codeExpiresAt: expiresAt,
      requestedByUserId: input.requestedByUserId ?? null,
    })
    .returning();

  const medium: "sms" | "email" = input.channel === "email" ? "email" : "sms";
  const text = legalCopy(IDENTITY_COPY.oneTimeCode.key, { firmName: input.firmName, code });

  const gated = await runGated(
    medium === "email" ? VENDOR_GATES.email.key : VENDOR_GATES.sms.key,
    "intake.identity.send_code",
    () => getOtpAdapter().dispatch({ tenantId: ctx.tenantId, medium, contactValue: onFileValue, text }),
    { tenantId: ctx.tenantId, detail: { verificationId: verification!.id } }
  );

  if (!gated.ok) {
    await auditBlocked(tx, gated.blocked, {
      tenantId: ctx.tenantId,
      engine: INTAKE_ENGINE,
      entityType: "intake_identity_verification",
      entityId: verification!.id,
      intakeSessionId: input.intakeSessionId ?? null,
    });
    return { status: "blocked_pending_vendor", verificationId: verification!.id, placeholder: gated.blocked.placeholder };
  }

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: INTAKE_ENGINE,
    action: "intake.identity.code_sent",
    entityType: "intake_identity_verification",
    entityId: verification!.id,
    intakeSessionId: input.intakeSessionId ?? null,
    payload: { channel: input.channel },
  });

  return { status: "sent", verificationId: verification!.id, codeExpiresAt: expiresAt };
}

export type VerifyCodeResult = { status: "verified" } | { status: "incorrect"; attemptsRemaining: number };

/** Check a code the caller just gave back. Enforces expiry and the attempt cap (see ./verification.ts). */
export async function verifyCode(
  tx: TenantTx,
  ctx: IdentityCtx,
  input: { verificationId: string; code: string; by: Actor }
): Promise<VerifyCodeResult> {
  const [row] = await tx
    .select()
    .from(intakeIdentityVerifications)
    .where(and(eq(intakeIdentityVerifications.tenantId, ctx.tenantId), eq(intakeIdentityVerifications.id, input.verificationId)))
    .limit(1);
  if (!row) throw new IntakeNotFoundError("Identity verification");
  const now = ctx.now ?? new Date();

  const decision = decideAttemptAllowed({
    status: row.status as "pending" | "verified" | "failed" | "expired",
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    codeExpiresAt: row.codeExpiresAt,
    now,
  });
  if (!decision.allowed) {
    if (row.status === "pending" && row.codeExpiresAt && now.getTime() >= row.codeExpiresAt.getTime()) {
      await tx.update(intakeIdentityVerifications).set({ status: "expired" }).where(eq(intakeIdentityVerifications.id, row.id));
    }
    throw new IntakeRuleError(decision.reason);
  }

  const providedHash = hashCode(input.code.trim(), row.codeSalt ?? "");
  if (codesMatch(providedHash, row.codeHash ?? "")) {
    await tx
      .update(intakeIdentityVerifications)
      .set({ status: "verified", verifiedAt: now })
      .where(eq(intakeIdentityVerifications.id, row.id));
    await audit(tx, {
      tenantId: ctx.tenantId,
      engine: INTAKE_ENGINE,
      action: "intake.identity.verified",
      entityType: "intake_identity_verification",
      entityId: row.id,
      intakeSessionId: row.intakeSessionId,
      actor: input.by,
      payload: { channel: row.channel },
    });
    return { status: "verified" };
  }

  const attempts = row.attempts + 1;
  const nextStatus = attempts >= row.maxAttempts ? "failed" : "pending";
  await tx
    .update(intakeIdentityVerifications)
    .set({ attempts, status: nextStatus })
    .where(eq(intakeIdentityVerifications.id, row.id));
  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: INTAKE_ENGINE,
    action: "intake.identity.verify_failed",
    entityType: "intake_identity_verification",
    entityId: row.id,
    intakeSessionId: row.intakeSessionId,
    actor: input.by,
    payload: { attempts },
  });
  return { status: "incorrect", attemptsRemaining: Math.max(row.maxAttempts - attempts, 0) };
}

// ---------------------------------------------------------------------------
// The actual gate: may matter information be shared, right now?
// ---------------------------------------------------------------------------

export interface DecideSharingInput {
  partyId: string;
  channel: VerificationChannel;
  contactValueProvided: string;
  portalAuthenticated: boolean;
  by: Actor;
}

/** c71's actual gate, called before any matter detail is read out over phone/text/email. Always audited, allowed or not. */
export async function decideSharing(tx: TenantTx, ctx: IdentityCtx, input: DecideSharingInput): Promise<SharingDecision> {
  const party = await loadParty(tx, ctx.tenantId, input.partyId);
  const onFile = toOnFile(party);

  const [latestRow] = await tx
    .select()
    .from(intakeIdentityVerifications)
    .where(and(eq(intakeIdentityVerifications.tenantId, ctx.tenantId), eq(intakeIdentityVerifications.partyId, party.id)))
    .orderBy(desc(intakeIdentityVerifications.requestedAt))
    .limit(1);

  const latest: PriorVerification | null = latestRow
    ? {
        status: latestRow.status as PriorVerification["status"],
        channel: latestRow.channel as VerificationChannel,
        contactValueUsed: latestRow.contactValueUsed,
        verifiedAt: latestRow.verifiedAt,
      }
    : null;

  const now = ctx.now ?? new Date();
  const decision = decideInfoSharingAllowed({
    channel: input.channel,
    contactValueProvided: input.contactValueProvided,
    onFile,
    portalAuthenticated: input.portalAuthenticated,
    latest,
    now,
  });

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: INTAKE_ENGINE,
    action: decision.allowed ? "intake.identity.sharing_allowed" : "intake.identity.sharing_blocked",
    entityType: "party",
    entityId: party.id,
    actor: input.by,
    payload: decision.allowed ? { channel: input.channel } : { channel: input.channel, reason: decision.reason },
  });

  return decision;
}

// Re-exported so callers (and tests) can normalise a contact the same way this service does.
export { normalizeEmail, normalizeName, normalizePhone } from "./matching";
