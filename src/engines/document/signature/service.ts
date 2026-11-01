// c4 — Document engine · e-signature envelope: the generic, multi-signer
// capability c39 (engagement agreement), c41 (pre-filing sign-off), c59
// (conflict waivers) and c52 (changed fee arrangements) all reuse.
//
// This is the FIRST code slice: create a draft envelope against one
// approved document version, send it (gated on vendor.esignature — no
// vendor is wired yet, so every send fails closed with a pending
// placeholder, exactly like c39's own SignatureRequestAdapter seam),
// record signer events in order, and complete/decline/expire/void it.
//
// NOT in this slice (see the PR description's "not done here"): producing
// the signed PDF + completion certificate as a new document version (c84)
// once an envelope completes; wiring c39's SignatureRequestAdapter to call
// through here instead of its own one-signer stub; routes, admin UI, and
// the worker-tick hook that calls expireOverdueEnvelopes() on a schedule.

import { and, eq } from "drizzle-orm";
import { documents } from "@/db/schema";
import { signatureEnvelopes, signatureSigners } from "@/db/tables/document";
import { audit, type Actor, type BusinessCalendar } from "@/core";
import { auditBlocked } from "@/core/audit";
import { requireApproval, runGated } from "@/compliance/approvals";
import type { TenantTx } from "@/tenancy/withTenant";
import { DocumentError, NotFoundError } from "../errors";
import { ENGINE } from "../settings";
import { decideMatter, type AccessContext, type StaffViewer } from "../access/policy";
import { actorOf } from "../access/service";
import { VENDOR_GATES } from "../gates";
import {
  canCompleteAgainstHash,
  decideSignerAction,
  defaultExpiryAt,
  isEnvelopeComplete,
  isExpired,
  nextSignerToAct,
  prepareSigners,
  type EnvelopePurpose,
  type EnvelopeStatus,
  type NewSignerSpec,
  type SignerStatus,
  type SignerSummary,
} from "./envelope";

/** Business rule 1 (spec §5): only an approved document version may be put in an envelope. */
export const ENVELOPE_ELIGIBLE_DOCUMENT_STATUSES = ["attorney_approved"] as const;

interface EnvelopeCtx {
  tenantId: string;
  viewer: StaffViewer;
  access: AccessContext;
  now?: Date;
}

function requireWrite(viewer: StaffViewer, what: string): void {
  if (!viewer.permissions.includes("documents.write")) {
    throw new DocumentError(`You cannot ${what}.`, 403);
  }
}

async function loadDocumentForEnvelope(tx: TenantTx, tenantId: string, documentId: string) {
  const [doc] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
    .limit(1);
  if (!doc) throw new NotFoundError("Document");
  return doc;
}

async function loadEnvelope(tx: TenantTx, tenantId: string, envelopeId: string) {
  const [e] = await tx
    .select()
    .from(signatureEnvelopes)
    .where(and(eq(signatureEnvelopes.tenantId, tenantId), eq(signatureEnvelopes.id, envelopeId)))
    .limit(1);
  if (!e) throw new NotFoundError("Envelope");
  return e;
}

async function loadSigners(tx: TenantTx, tenantId: string, envelopeId: string) {
  return tx
    .select()
    .from(signatureSigners)
    .where(and(eq(signatureSigners.tenantId, tenantId), eq(signatureSigners.envelopeId, envelopeId)))
    .orderBy(signatureSigners.orderNo);
}

/**
 * The DB column is plain text (with a CHECK constraint), so drizzle types
 * `status` as `string`. Narrow each row to the pure SignerSummary shape the
 * envelope.ts decision functions take.
 */
function toSignerSummaries(rows: readonly { orderNo: number; status: string }[]): SignerSummary[] {
  return rows.map((r) => ({ orderNo: r.orderNo, status: r.status as SignerStatus }));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateEnvelopeInput {
  documentId: string;
  purpose: EnvelopePurpose;
  signers: readonly NewSignerSpec[];
}

export interface CreateEnvelopeResult {
  envelopeId: string;
  documentId: string;
  matterId: string;
}

/** Draft an envelope against one approved document version, with its signers in order. Sends nothing yet. */
export async function createEnvelope(tx: TenantTx, ctx: EnvelopeCtx, input: CreateEnvelopeInput): Promise<CreateEnvelopeResult> {
  requireWrite(ctx.viewer, "create a signature envelope");
  const doc = await loadDocumentForEnvelope(tx, ctx.tenantId, input.documentId);
  if (!(ENVELOPE_ELIGIBLE_DOCUMENT_STATUSES as readonly string[]).includes(doc.status)) {
    throw new DocumentError(`A document in status '${doc.status}' is not approved for signature.`, 409);
  }
  if (!doc.sha256) {
    throw new DocumentError("This document version has no checksum yet; it cannot be put in an envelope.", 409);
  }
  const scope = decideMatter(ctx.viewer, doc.matterId, ctx.access);
  if (!scope.allowed) throw new DocumentError("You do not have access to this matter.", 403, { reason: scope.reason });

  const prepared = prepareSigners(input.signers);
  const now = ctx.now ?? new Date();

  const [envelope] = await tx
    .insert(signatureEnvelopes)
    .values({
      tenantId: ctx.tenantId,
      matterId: doc.matterId,
      documentId: doc.id,
      documentSha256: doc.sha256,
      purpose: input.purpose,
      status: "draft",
      createdByUserId: ctx.viewer.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await tx.insert(signatureSigners).values(
    prepared.map((s) => ({
      tenantId: ctx.tenantId,
      envelopeId: envelope!.id,
      orderNo: s.orderNo,
      signerType: s.signerType,
      partyId: s.partyId ?? null,
      userId: s.userId ?? null,
      identityMethod: s.identityMethod,
      status: "pending" as const,
    }))
  );

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: "document.signature.envelope_created",
    entityType: "signature_envelope",
    entityId: envelope!.id,
    matterId: doc.matterId,
    actor: actorOf(ctx.viewer),
    payload: { documentId: doc.id, purpose: input.purpose, signerCount: prepared.length },
  });

  return { envelopeId: envelope!.id, documentId: doc.id, matterId: doc.matterId };
}

// ---------------------------------------------------------------------------
// Dispatch adapter seam (for a real vendor to fill in later — c4 open question 1)
// ---------------------------------------------------------------------------

export interface EnvelopeDispatchAdapter {
  readonly name: string;
  dispatch(input: {
    tenantId: string;
    envelopeId: string;
    firstSigner: { signerType: string; partyId: string | null; userId: string | null };
  }): Promise<{ vendorEnvelopeId: string }>;
}

/** No e-signature vendor is wired yet: every call fails closed through vendor.esignature. */
export class UnavailableEnvelopeAdapter implements EnvelopeDispatchAdapter {
  readonly name = "unavailable";
  async dispatch(input: { tenantId: string }): Promise<{ vendorEnvelopeId: string }> {
    requireApproval(VENDOR_GATES.esignature.key, { action: "document.signature.send", tenantId: input.tenantId });
    // requireApproval always throws while the gate is pending; reachable only
    // once a real adapter is swapped in with setEnvelopeAdapter().
    throw new Error("UnavailableEnvelopeAdapter: no e-signature vendor configured.");
  }
}

let envelopeAdapter: EnvelopeDispatchAdapter = new UnavailableEnvelopeAdapter();

export function setEnvelopeAdapter(next: EnvelopeDispatchAdapter | null): void {
  envelopeAdapter = next ?? new UnavailableEnvelopeAdapter();
}

export function getEnvelopeAdapter(): EnvelopeDispatchAdapter {
  return envelopeAdapter;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export type SendEnvelopeResult =
  | { status: "sent"; envelopeId: string; expiresAt: Date }
  | { status: "blocked_pending_esignature_vendor"; envelopeId: string; placeholder: string };

/** Lock the envelope to its signers' order and send it. Gated: fails closed until a vendor is wired. */
export async function sendEnvelope(
  tx: TenantTx,
  ctx: EnvelopeCtx & { cal: BusinessCalendar },
  envelopeId: string
): Promise<SendEnvelopeResult> {
  requireWrite(ctx.viewer, "send a signature envelope");
  const envelope = await loadEnvelope(tx, ctx.tenantId, envelopeId);
  if (envelope.status !== "draft") throw new DocumentError(`Envelope is '${envelope.status}', not a draft.`, 409);
  const scope = decideMatter(ctx.viewer, envelope.matterId, ctx.access);
  if (!scope.allowed) throw new DocumentError("You do not have access to this matter.", 403, { reason: scope.reason });
  const signers = await loadSigners(tx, ctx.tenantId, envelopeId);
  const first = signers.find((s) => s.orderNo === 0);
  if (!first) throw new DocumentError("Envelope has no signers.", 409);

  const now = ctx.now ?? new Date();
  const adapter = getEnvelopeAdapter();
  const gated = await runGated(
    VENDOR_GATES.esignature.key,
    "document.signature.send",
    () =>
      adapter.dispatch({
        tenantId: ctx.tenantId,
        envelopeId,
        firstSigner: { signerType: first.signerType, partyId: first.partyId, userId: first.userId },
      }),
    { tenantId: ctx.tenantId, detail: { envelopeId, matterId: envelope.matterId } }
  );

  if (!gated.ok) {
    await auditBlocked(tx, gated.blocked, {
      tenantId: ctx.tenantId,
      engine: ENGINE,
      entityType: "signature_envelope",
      entityId: envelopeId,
      matterId: envelope.matterId,
      actor: actorOf(ctx.viewer),
    });
    return { status: "blocked_pending_esignature_vendor", envelopeId, placeholder: gated.blocked.placeholder };
  }

  const expiresAt = defaultExpiryAt(now, ctx.cal);
  await tx
    .update(signatureEnvelopes)
    .set({ status: "sent", vendor: adapter.name, vendorEnvelopeId: gated.value.vendorEnvelopeId, sentAt: now, expiresAt, updatedAt: now })
    .where(eq(signatureEnvelopes.id, envelopeId));
  await tx
    .update(signatureSigners)
    .set({ status: "sent", sentAt: now })
    .where(and(eq(signatureSigners.envelopeId, envelopeId), eq(signatureSigners.orderNo, 0)));

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: "document.signature.envelope_sent",
    entityType: "signature_envelope",
    entityId: envelopeId,
    matterId: envelope.matterId,
    actor: actorOf(ctx.viewer),
    payload: { vendorEnvelopeId: gated.value.vendorEnvelopeId, expiresAt: expiresAt.toISOString() },
  });

  return { status: "sent", envelopeId, expiresAt };
}

// ---------------------------------------------------------------------------
// Signer events
// ---------------------------------------------------------------------------

export type SignerEvent = "viewed" | "signed" | "declined";

export interface RecordSignerEventInput {
  envelopeId: string;
  orderNo: number;
  event: SignerEvent;
  /** Required for 'declined'. Ignored otherwise. */
  declineReason?: string | null;
  by: Actor;
  now?: Date;
}

export type RecordSignerEventResult =
  | { status: "viewed" }
  | { status: "signed"; envelopeCompleted: boolean }
  | { status: "declined" };

/** Record one signer's action. Enforces signing order and, for 'signed', the hash binding (acceptance criterion 3). */
export async function recordSignerEvent(tx: TenantTx, tenantId: string, input: RecordSignerEventInput): Promise<RecordSignerEventResult> {
  const envelope = await loadEnvelope(tx, tenantId, input.envelopeId);
  const signers = await loadSigners(tx, tenantId, input.envelopeId);
  const target = signers.find((s) => s.orderNo === input.orderNo);
  if (!target) throw new NotFoundError("Signer");
  const now = input.now ?? new Date();

  const summaries = toSignerSummaries(signers);
  const targetSummary: SignerSummary = { orderNo: target.orderNo, status: target.status as SignerStatus };

  const decision = decideSignerAction({
    envelopeStatus: envelope.status as EnvelopeStatus,
    signer: targetSummary,
    signers: summaries,
  });
  if (!decision.allowed) throw new DocumentError(decision.reason, 409);

  if (input.event === "viewed") {
    await tx.update(signatureSigners).set({ status: "viewed", viewedAt: now }).where(eq(signatureSigners.id, target.id));
    await audit(tx, {
      tenantId,
      engine: ENGINE,
      action: "document.signature.signer_viewed",
      entityType: "signature_envelope",
      entityId: envelope.id,
      matterId: envelope.matterId,
      actor: input.by,
      payload: { orderNo: input.orderNo },
    });
    return { status: "viewed" };
  }

  if (input.event === "declined") {
    const reason = input.declineReason?.trim();
    if (!reason) throw new DocumentError("A reason is required to decline.", 422);
    await tx
      .update(signatureSigners)
      .set({ status: "declined", declinedAt: now, declineReason: reason })
      .where(eq(signatureSigners.id, target.id));
    await tx
      .update(signatureEnvelopes)
      .set({ status: "declined", declinedAt: now, updatedAt: now })
      .where(eq(signatureEnvelopes.id, envelope.id));
    await audit(tx, {
      tenantId,
      engine: ENGINE,
      action: "document.signature.envelope_declined",
      entityType: "signature_envelope",
      entityId: envelope.id,
      matterId: envelope.matterId,
      actor: input.by,
      payload: { orderNo: input.orderNo, reason },
    });
    return { status: "declined" };
  }

  // 'signed'
  const currentDoc = await loadDocumentForEnvelope(tx, tenantId, envelope.documentId);
  if (!currentDoc.sha256 || !canCompleteAgainstHash(envelope.documentSha256, currentDoc.sha256)) {
    throw new DocumentError("This document has a newer version; void this envelope and send a new one.", 409);
  }
  await tx.update(signatureSigners).set({ status: "signed", signedAt: now }).where(eq(signatureSigners.id, target.id));

  const updatedSigners: SignerSummary[] = summaries.map((s) =>
    s.orderNo === input.orderNo ? { orderNo: s.orderNo, status: "signed" } : s
  );
  const next = nextSignerToAct(updatedSigners);
  if (next && next.orderNo !== input.orderNo) {
    await tx
      .update(signatureSigners)
      .set({ status: "sent", sentAt: now })
      .where(and(eq(signatureSigners.envelopeId, envelope.id), eq(signatureSigners.orderNo, next.orderNo)));
  }

  const completed = isEnvelopeComplete(updatedSigners);
  if (completed) {
    await tx
      .update(signatureEnvelopes)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(signatureEnvelopes.id, envelope.id));
  }

  await audit(tx, {
    tenantId,
    engine: ENGINE,
    action: completed ? "document.signature.envelope_completed" : "document.signature.signer_signed",
    entityType: "signature_envelope",
    entityId: envelope.id,
    matterId: envelope.matterId,
    actor: input.by,
    payload: { orderNo: input.orderNo },
  });

  return { status: "signed", envelopeCompleted: completed };
}

// ---------------------------------------------------------------------------
// Void / expire
// ---------------------------------------------------------------------------

/** Business rule 2: a completed envelope is never corrected in place — only a lawyer may void one that is still open. */
export async function voidEnvelope(tx: TenantTx, ctx: EnvelopeCtx, input: { envelopeId: string; reason: string }): Promise<void> {
  if (!ctx.viewer.permissions.includes("documents.approve")) {
    throw new DocumentError("Only an attorney can void a signature envelope.", 403);
  }
  const envelope = await loadEnvelope(tx, ctx.tenantId, input.envelopeId);
  if (envelope.status === "completed" || envelope.status === "voided") {
    throw new DocumentError(`Envelope is already '${envelope.status}'.`, 409);
  }
  const reason = input.reason.trim();
  if (!reason) throw new DocumentError("A reason is required to void an envelope.", 422);
  const now = ctx.now ?? new Date();
  await tx
    .update(signatureEnvelopes)
    .set({ status: "voided", voidedAt: now, voidReason: reason, updatedAt: now })
    .where(eq(signatureEnvelopes.id, envelope.id));
  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: "document.signature.envelope_voided",
    entityType: "signature_envelope",
    entityId: envelope.id,
    matterId: envelope.matterId,
    actor: actorOf(ctx.viewer),
    reason,
    payload: {},
  });
}

/**
 * Expire every 'sent' envelope past its expiry (acceptance criterion 6).
 * Called by a worker tick hook once one is wired up (not in this PR — see
 * the "not done here" note at the top of this file).
 */
export async function expireOverdueEnvelopes(tx: TenantTx, tenantId: string, now: Date): Promise<string[]> {
  const rows = await tx
    .select({ id: signatureEnvelopes.id, matterId: signatureEnvelopes.matterId, expiresAt: signatureEnvelopes.expiresAt })
    .from(signatureEnvelopes)
    .where(and(eq(signatureEnvelopes.tenantId, tenantId), eq(signatureEnvelopes.status, "sent")));
  const due = rows.filter((r) => r.expiresAt && isExpired(now, r.expiresAt));
  for (const r of due) {
    await tx
      .update(signatureEnvelopes)
      .set({ status: "expired", expiredAt: now, updatedAt: now })
      .where(eq(signatureEnvelopes.id, r.id));
    await audit(tx, {
      tenantId,
      engine: ENGINE,
      action: "document.signature.envelope_expired",
      entityType: "signature_envelope",
      entityId: r.id,
      matterId: r.matterId,
      actor: { type: "system" },
      payload: {},
    });
  }
  return due.map((r) => r.id);
}
