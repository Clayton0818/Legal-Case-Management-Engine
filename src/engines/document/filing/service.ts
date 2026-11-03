// c86 — Document engine · file documents with the court and track service.
//
// Submit filings to eFileTexas (and federal CM/ECF where supported) from the
// matter, only after the lawyer approves and the client has signed off where
// required (c41) — enforced here by requiring the document version itself be
// 'attorney_approved' (./rules.ts), the same bar c4 sets for a signature
// envelope; a pre-filing sign-off upgrades to that status upstream of this
// file (../signature/service.ts, purpose 'pre_filing'), so this engine never
// re-decides it. Tracks filing status (submitted, accepted, rejected with
// reason) and service on other parties. Stamped copies and service proof are
// ordinary document uploads (../store/service.ts) the caller links back here
// once staff have them — this file does not fetch or generate bytes.
// Returned court notices are a separate inbound channel the calendar-alerts
// engine owns (c64); this engine never imports it.
//
// NOT in this slice (left for a follow-up PR, same as c4's first slice):
// API routes, an admin UI, and a worker-tick hook to poll vendor status once
// a real adapter exists. Filing vendor terms and costs still need review
// (VENDOR_GATES.efiling) before any vendor is wired in.

import { and, desc, eq } from "drizzle-orm";
import { documents, matters } from "@/db/schema";
import { courtFilings, filingServiceRecords } from "@/db/tables/document";
import { audit, type Actor } from "@/core";
import { auditBlocked } from "@/core/audit";
import { runGated } from "@/compliance/approvals";
import type { TenantTx } from "@/tenancy/withTenant";
import { DocumentError, NotFoundError } from "../errors";
import { ENGINE } from "../settings";
import { decideMatter, type AccessContext, type StaffViewer } from "../access/policy";
import { actorOf } from "../access/service";
import { VENDOR_GATES } from "../gates";
import { getEfilingAdapter } from "./adapter";
import {
  canAttachStampedCopy,
  canRecordDecision,
  canRecordService,
  canSubmitFiling,
  FILING_ELIGIBLE_DOCUMENT_STATUSES,
  type FilingStatus,
  type FilingType,
  type ServiceMethod,
} from "./rules";

interface FilingCtx {
  tenantId: string;
  viewer: StaffViewer;
  access: AccessContext;
  now?: Date;
}

function requireWrite(viewer: StaffViewer, what: string): void {
  if (!viewer.permissions.includes("documents.write")) throw new DocumentError(`You cannot ${what}.`, 403);
}

/** Opening and deciding a filing are lawyer actions (card note: "only after the lawyer approves"). */
function requireLawyer(viewer: StaffViewer, what: string): void {
  if (!viewer.permissions.includes("documents.approve")) throw new DocumentError(`Only an attorney can ${what}.`, 403);
}

async function loadDocumentForFiling(tx: TenantTx, tenantId: string, documentId: string) {
  const [doc] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, documentId)))
    .limit(1);
  if (!doc) throw new NotFoundError("Document");
  return doc;
}

async function loadFiling(tx: TenantTx, tenantId: string, filingId: string) {
  const [f] = await tx
    .select()
    .from(courtFilings)
    .where(and(eq(courtFilings.tenantId, tenantId), eq(courtFilings.id, filingId)))
    .limit(1);
  if (!f) throw new NotFoundError("Filing");
  return f;
}

function requireMatterAccess(ctx: FilingCtx, matterId: string): void {
  const scope = decideMatter(ctx.viewer, matterId, ctx.access);
  if (!scope.allowed) throw new DocumentError("You do not have access to this matter.", 403, { reason: scope.reason });
}

// ---------------------------------------------------------------------------
// Create (draft)
// ---------------------------------------------------------------------------

export interface CreateFilingInput {
  documentId: string;
  filingType: FilingType;
  court: string;
}

export interface CreateFilingResult {
  filingId: string;
  matterId: string;
  documentId: string;
}

/** Draft a filing against one attorney-approved document version. Submits nothing yet. */
export async function createFiling(tx: TenantTx, ctx: FilingCtx, input: CreateFilingInput): Promise<CreateFilingResult> {
  requireLawyer(ctx.viewer, "open a court filing");
  const doc = await loadDocumentForFiling(tx, ctx.tenantId, input.documentId);
  requireMatterAccess(ctx, doc.matterId);
  if (!(FILING_ELIGIBLE_DOCUMENT_STATUSES as readonly string[]).includes(doc.status)) {
    throw new DocumentError(`A document in status '${doc.status}' is not approved for filing.`, 409);
  }
  const court = input.court.trim();
  if (!court) throw new DocumentError("'court' is required.", 422);
  const now = ctx.now ?? new Date();

  const [filing] = await tx
    .insert(courtFilings)
    .values({
      tenantId: ctx.tenantId,
      matterId: doc.matterId,
      documentId: doc.id,
      filingType: input.filingType,
      court,
      status: "draft",
      createdByUserId: ctx.viewer.userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: "document.filing.created",
    entityType: "court_filing",
    entityId: filing!.id,
    matterId: doc.matterId,
    actor: actorOf(ctx.viewer),
    payload: { documentId: doc.id, filingType: input.filingType, court },
  });

  return { filingId: filing!.id, matterId: doc.matterId, documentId: doc.id };
}

// ---------------------------------------------------------------------------
// Submit (gated on vendor.efiling)
// ---------------------------------------------------------------------------

export type SubmitFilingResult =
  | { status: "submitted"; filingId: string; vendorFilingId: string }
  | { status: "blocked_pending_efiling_vendor"; filingId: string; placeholder: string };

/** Send a draft filing to the e-filing vendor. Fails closed until a vendor is wired in. */
export async function submitFiling(tx: TenantTx, ctx: FilingCtx, filingId: string): Promise<SubmitFilingResult> {
  requireWrite(ctx.viewer, "submit a court filing");
  const filing = await loadFiling(tx, ctx.tenantId, filingId);
  requireMatterAccess(ctx, filing.matterId);
  const doc = await loadDocumentForFiling(tx, ctx.tenantId, filing.documentId);
  const decision = canSubmitFiling(filing.status as FilingStatus, doc.status);
  if (!decision.allowed) throw new DocumentError(decision.reason!, 409);

  const now = ctx.now ?? new Date();
  const adapter = getEfilingAdapter();
  const gated = await runGated(
    VENDOR_GATES.efiling.key,
    "document.filing.submit",
    () => adapter.submit({ tenantId: ctx.tenantId, filingId, court: filing.court, filingType: filing.filingType }),
    { tenantId: ctx.tenantId, detail: { filingId, matterId: filing.matterId } }
  );

  if (!gated.ok) {
    await auditBlocked(tx, gated.blocked, {
      tenantId: ctx.tenantId,
      engine: ENGINE,
      entityType: "court_filing",
      entityId: filingId,
      matterId: filing.matterId,
      actor: actorOf(ctx.viewer),
    });
    return { status: "blocked_pending_efiling_vendor", filingId, placeholder: gated.blocked.placeholder };
  }

  await tx
    .update(courtFilings)
    .set({ status: "submitted", vendor: adapter.name, vendorFilingId: gated.value.vendorFilingId, submittedAt: now, updatedAt: now })
    .where(eq(courtFilings.id, filingId));

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: "document.filing.submitted",
    entityType: "court_filing",
    entityId: filingId,
    matterId: filing.matterId,
    actor: actorOf(ctx.viewer),
    payload: { vendorFilingId: gated.value.vendorFilingId },
  });

  return { status: "submitted", filingId, vendorFilingId: gated.value.vendorFilingId };
}

// ---------------------------------------------------------------------------
// Decision (accepted / rejected)
// ---------------------------------------------------------------------------

export type FilingDecision = "accepted" | "rejected";

/** Record what the court decided about a submitted filing. A rejection requires a reason; it is never resubmitted in place (./rules.ts). */
export async function recordFilingDecision(
  tx: TenantTx,
  ctx: FilingCtx,
  input: { filingId: string; decision: FilingDecision; rejectionReason?: string | null }
): Promise<void> {
  requireWrite(ctx.viewer, "record a court filing decision");
  const filing = await loadFiling(tx, ctx.tenantId, input.filingId);
  requireMatterAccess(ctx, filing.matterId);
  const check = canRecordDecision(filing.status as FilingStatus);
  if (!check.allowed) throw new DocumentError(check.reason!, 409);

  let rejectionReason: string | null = null;
  if (input.decision === "rejected") {
    rejectionReason = input.rejectionReason?.trim() || null;
    if (!rejectionReason) throw new DocumentError("A reason is required to record a rejection.", 422);
  }

  const now = ctx.now ?? new Date();
  await tx
    .update(courtFilings)
    .set({ status: input.decision, decidedAt: now, rejectionReason, updatedAt: now })
    .where(eq(courtFilings.id, input.filingId));

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: input.decision === "accepted" ? "document.filing.accepted" : "document.filing.rejected",
    entityType: "court_filing",
    entityId: input.filingId,
    matterId: filing.matterId,
    actor: actorOf(ctx.viewer),
    payload: input.decision === "rejected" ? { reason: rejectionReason } : {},
  });
}

// ---------------------------------------------------------------------------
// Service on other parties
// ---------------------------------------------------------------------------

export interface RecordServiceInput {
  filingId: string;
  method: ServiceMethod;
  partyId?: string | null;
  servedOnName?: string | null;
}

/** Open a service record for one other party on an accepted filing. Status starts 'pending'. */
export async function openServiceRecord(tx: TenantTx, ctx: FilingCtx, input: RecordServiceInput): Promise<string> {
  requireWrite(ctx.viewer, "record service of a court filing");
  const filing = await loadFiling(tx, ctx.tenantId, input.filingId);
  requireMatterAccess(ctx, filing.matterId);
  const check = canRecordService(filing.status as FilingStatus);
  if (!check.allowed) throw new DocumentError(check.reason!, 409);
  const partyId = input.partyId ?? null;
  const servedOnName = input.servedOnName?.trim() || null;
  if (!partyId && !servedOnName) throw new DocumentError("Either 'partyId' or 'servedOnName' is required.", 422);

  const [row] = await tx
    .insert(filingServiceRecords)
    .values({ tenantId: ctx.tenantId, filingId: input.filingId, partyId, servedOnName, method: input.method, status: "pending" })
    .returning();

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: "document.filing.service_opened",
    entityType: "filing_service_record",
    entityId: row!.id,
    matterId: filing.matterId,
    actor: actorOf(ctx.viewer),
    payload: { filingId: input.filingId, method: input.method },
  });

  return row!.id;
}

/** Mark one service record completed or failed, optionally with proof of service (an existing uploaded document). */
export async function completeServiceRecord(
  tx: TenantTx,
  ctx: FilingCtx,
  input: { serviceRecordId: string; outcome: "completed" | "failed"; failureReason?: string | null; proofDocumentId?: string | null }
): Promise<void> {
  requireWrite(ctx.viewer, "update a service record");
  const [record] = await tx
    .select()
    .from(filingServiceRecords)
    .where(and(eq(filingServiceRecords.tenantId, ctx.tenantId), eq(filingServiceRecords.id, input.serviceRecordId)))
    .limit(1);
  if (!record) throw new NotFoundError("Service record");
  const filing = await loadFiling(tx, ctx.tenantId, record.filingId);
  requireMatterAccess(ctx, filing.matterId);
  if (record.status !== "pending") throw new DocumentError(`Service record is '${record.status}', not pending.`, 409);

  let failureReason: string | null = null;
  if (input.outcome === "failed") {
    failureReason = input.failureReason?.trim() || null;
    if (!failureReason) throw new DocumentError("A reason is required to record failed service.", 422);
  }
  let proofDocumentId: string | null = null;
  if (input.proofDocumentId) {
    const proof = await loadDocumentForFiling(tx, ctx.tenantId, input.proofDocumentId);
    if (proof.matterId !== filing.matterId) throw new DocumentError("The proof document belongs to a different matter.", 422);
    proofDocumentId = proof.id;
  }

  const now = ctx.now ?? new Date();
  await tx
    .update(filingServiceRecords)
    .set({ status: input.outcome, completedAt: now, failureReason, proofDocumentId })
    .where(eq(filingServiceRecords.id, input.serviceRecordId));

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: input.outcome === "completed" ? "document.filing.service_completed" : "document.filing.service_failed",
    entityType: "filing_service_record",
    entityId: input.serviceRecordId,
    matterId: filing.matterId,
    actor: actorOf(ctx.viewer),
    payload: input.outcome === "failed" ? { reason: failureReason } : {},
  });
}

// ---------------------------------------------------------------------------
// Stamped copy
// ---------------------------------------------------------------------------

/** Link the court-stamped copy, once staff have uploaded it back to the matter (../store/service.ts), to its filing. */
export async function attachStampedCopy(tx: TenantTx, ctx: FilingCtx, input: { filingId: string; stampedDocumentId: string }): Promise<void> {
  requireWrite(ctx.viewer, "attach a stamped copy");
  const filing = await loadFiling(tx, ctx.tenantId, input.filingId);
  requireMatterAccess(ctx, filing.matterId);
  const check = canAttachStampedCopy(filing.status as FilingStatus);
  if (!check.allowed) throw new DocumentError(check.reason!, 409);
  const stamped = await loadDocumentForFiling(tx, ctx.tenantId, input.stampedDocumentId);
  if (stamped.matterId !== filing.matterId) throw new DocumentError("The stamped copy belongs to a different matter.", 422);

  await tx
    .update(courtFilings)
    .set({ stampedDocumentId: stamped.id, updatedAt: ctx.now ?? new Date() })
    .where(eq(courtFilings.id, input.filingId));

  await audit(tx, {
    tenantId: ctx.tenantId,
    engine: ENGINE,
    action: "document.filing.stamped_copy_attached",
    entityType: "court_filing",
    entityId: input.filingId,
    matterId: filing.matterId,
    actor: actorOf(ctx.viewer),
    payload: { stampedDocumentId: stamped.id },
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listFilingsForMatter(tx: TenantTx, ctx: FilingCtx, matterId: string) {
  requireMatterAccess(ctx, matterId);
  const [matter] = await tx.select({ id: matters.id }).from(matters).where(and(eq(matters.tenantId, ctx.tenantId), eq(matters.id, matterId))).limit(1);
  if (!matter) throw new NotFoundError("Matter");
  return tx
    .select()
    .from(courtFilings)
    .where(and(eq(courtFilings.tenantId, ctx.tenantId), eq(courtFilings.matterId, matterId)))
    .orderBy(desc(courtFilings.createdAt));
}

export async function listServiceRecords(tx: TenantTx, ctx: FilingCtx, filingId: string) {
  const filing = await loadFiling(tx, ctx.tenantId, filingId);
  requireMatterAccess(ctx, filing.matterId);
  return tx.select().from(filingServiceRecords).where(and(eq(filingServiceRecords.tenantId, ctx.tenantId), eq(filingServiceRecords.filingId, filingId)));
}

/** Re-export for callers that only need the actor shape (routes, admin UI, tests). */
export type { Actor };
