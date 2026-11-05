// c88 — the redaction tool. Documents are immutable per version (c84), so
// redacting is never an in-place edit: it produces a NEW version with the
// matched text permanently removed, exactly like any other version (see
// src/db/tables/document.ts's top comment and uploadDocument() in
// ../store/service.ts, whose version-creation steps this mirrors).
//
// Flow, and why it is three steps rather than one:
//   1. suggestRedactions   — heuristic detection only (detect.ts); nothing is
//      changed yet, and the suggestion row never stores the matched text.
//   2. confirmAndApplyRedaction — a human (with the same documents.approve
//      decision right as a privilege-tag weakening — see
//      ../store/service.ts's updateDocumentGroup) reviews the candidates and
//      picks the EXACT spans to remove, with a reason. Confirming and
//      applying are one call on purpose: there is no separate "confirmed but
//      not yet applied" state a span could silently sit in — the moment a
//      human signs off IS the moment it happens, so nothing is ever
//      auto-applied.
//   3. rejectRedactionSuggestion — the human may instead decline everything.
//
// Scope for this PR: only mime types whose extracted text IS essentially the
// file's content (text/plain, text/csv, text/markdown) are supported, since
// the redacted version is produced by re-saving the (already
// whitespace-normalised) extracted text as the new version's bytes — true
// structural redaction of PDF/Word/image documents, preserving their layout,
// is real additional engineering and is flagged as a follow-up in the PR
// description rather than attempted here.

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { documents, matterParties, parties } from "@/db/schema";
import { documentGroups, documentRedactions, documentText, documentVersionFiles, type RedactionCategory, type RedactionSpan } from "@/db/tables/document";
import { audit } from "@/core";
import type { TenantTx } from "@/tenancy/withTenant";
import { DocumentError, NotFoundError } from "../errors";
import { ENGINE } from "../settings";
import { decideDocumentAccess } from "../access/policy";
import { actorOf, logAccess } from "../access/service";
import { gatedAdapters } from "../storage/adapters";
import { sha256Hex, storageKeyFor } from "../versions/versioning";
import { indexVersionText } from "../extraction/service";
import { loadVersion, type Ctx } from "../store/service";
import { applyRedactionSpans, detectRedactionCandidates, validateSpans } from "./detect";

export type { RedactionCategory, RedactionSpan };

/** Mime types this pass can redact: ones whose extracted text IS (close to) the file's content. PDF/Word/image are a follow-up. */
const REDACTABLE_MIME_TYPES = new Set(["text/plain", "text/csv", "text/markdown"]);

function textSha256(content: string): string {
  return sha256Hex(new TextEncoder().encode(content));
}

function isMinor(dateOfBirth: string | null, now: Date): boolean {
  if (!dateOfBirth) return false;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age < 18;
}

/** Full names + aliases of parties on this matter known to be minors: role = 'child', or a date of birth under 18. Pure apart from the read. */
async function minorNamesForMatter(tx: TenantTx, tenantId: string, matterId: string, now: Date): Promise<string[]> {
  const rows = await tx
    .select({ fullName: parties.fullName, aliases: parties.aliases, dateOfBirth: parties.dateOfBirth, role: matterParties.role })
    .from(matterParties)
    .innerJoin(parties, eq(parties.id, matterParties.partyId))
    .where(and(eq(matterParties.tenantId, tenantId), eq(matterParties.matterId, matterId)));
  const names: string[] = [];
  for (const row of rows) {
    if (row.role !== "child" && !isMinor(row.dateOfBirth, now)) continue;
    if (row.fullName) names.push(row.fullName);
    for (const alias of row.aliases ?? []) if (alias) names.push(alias);
  }
  return names;
}

export interface RedactionCandidate extends RedactionSpan {
  /** The matched text, for the reviewer only — never written to the database (c88: "do not store the actual sensitive matched text"). */
  preview: string;
}

export interface SuggestRedactionsResult {
  redactionId: string;
  documentId: string;
  groupId: string;
  candidates: RedactionCandidate[];
  categories: RedactionCategory[];
}

/** Step 1: run the heuristic pass against a version's extracted text and store the (text-free) suggestion. Never changes any bytes. */
export async function suggestRedactions(tx: TenantTx, ctx: Ctx, documentId: string): Promise<SuggestRedactionsResult> {
  const { tenantId, viewer } = ctx;
  const row = await loadVersion(tx, tenantId, documentId);
  if (!row) throw new NotFoundError("Document");
  const { d, g } = row;
  const decision = decideDocumentAccess(viewer, "edit", { matterId: d.matterId, privilegeTag: d.privilegeTag, clientVisible: d.clientVisible }, ctx.access);
  if (!decision.allowed) throw new DocumentError("You cannot change this document.", 403, { reason: decision.reason });

  const [text] = await tx.select().from(documentText).where(eq(documentText.documentId, d.id)).limit(1);
  if (!text || text.status !== "extracted") {
    throw new DocumentError("This document's text has not finished indexing yet; try again shortly.", 409);
  }
  if (text.truncated) {
    throw new DocumentError("This document's extracted text was truncated for indexing; redaction is not supported on a truncated version yet.", 422);
  }

  const now = ctx.now ?? new Date();
  const minorNames = await minorNamesForMatter(tx, tenantId, d.matterId, now);
  const spans = detectRedactionCandidates(text.content, minorNames);
  const categories = [...new Set(spans.map((s) => s.category))];

  const [inserted] = await tx
    .insert(documentRedactions)
    .values({
      tenantId,
      matterId: d.matterId,
      groupId: g.id,
      sourceDocumentId: d.id,
      status: "suggested",
      method: "heuristic",
      suggestedSpans: spans,
      suggestedCategories: categories,
      textSha256: textSha256(text.content),
      suggestedAt: now,
    })
    .returning({ id: documentRedactions.id });

  await audit(tx, {
    tenantId,
    engine: ENGINE,
    action: "document.redaction.suggested",
    entityType: "document",
    entityId: d.id,
    matterId: d.matterId,
    actor: actorOf(viewer),
    payload: { redactionId: inserted!.id, spanCount: spans.length, categories },
  });

  return {
    redactionId: inserted!.id,
    documentId: d.id,
    groupId: g.id,
    candidates: spans.map((s) => ({ ...s, preview: text.content.slice(s.start, s.end) })),
    categories,
  };
}

export interface GetRedactionSuggestionResult {
  redactionId: string;
  status: string;
  documentId: string;
  groupId: string;
  /** True when the document's text has changed since this suggestion (a confirm will be refused). */
  stale: boolean;
  candidates: RedactionCandidate[];
  categories: string[];
}

/** Re-fetch a suggestion with a fresh preview, for the review screen. Never mutates. */
export async function getRedactionSuggestion(tx: TenantTx, ctx: Ctx, redactionId: string): Promise<GetRedactionSuggestionResult> {
  const { tenantId, viewer } = ctx;
  const [r] = await tx
    .select()
    .from(documentRedactions)
    .where(and(eq(documentRedactions.tenantId, tenantId), eq(documentRedactions.id, redactionId)))
    .limit(1);
  if (!r) throw new NotFoundError("Redaction suggestion");
  const row = await loadVersion(tx, tenantId, r.sourceDocumentId);
  if (!row) throw new NotFoundError("Document");
  const decision = decideDocumentAccess(viewer, "view", { matterId: row.d.matterId, privilegeTag: row.d.privilegeTag, clientVisible: row.d.clientVisible }, ctx.access);
  if (!decision.allowed) throw new DocumentError("You cannot see this document.", 403, { reason: decision.reason });

  const [text] = await tx.select().from(documentText).where(eq(documentText.documentId, r.sourceDocumentId)).limit(1);
  const stale = r.status !== "suggested" ? false : !text || textSha256(text.content) !== r.textSha256;
  return {
    redactionId: r.id,
    status: r.status,
    documentId: r.sourceDocumentId,
    groupId: r.groupId,
    stale,
    candidates: stale || !text ? [] : r.suggestedSpans.map((s) => ({ ...s, preview: text.content.slice(s.start, s.end) })),
    categories: r.suggestedCategories,
  };
}

function spanKey(s: RedactionSpan): string {
  return `${s.start}:${s.end}:${s.category}`;
}

export interface ConfirmRedactionInput {
  /** Must each be one of the spans this suggestion offered — no new spans may be introduced here. */
  confirmedSpans: RedactionSpan[];
  /** Required: why this is being permanently removed (c88 — this is the "person confirms" record). */
  reason: string;
}

export interface ConfirmRedactionResult {
  redactionId: string;
  groupId: string;
  sourceDocumentId: string;
  redactedDocumentId: string;
  version: number;
  spanCount: number;
  categories: RedactionCategory[];
}

/**
 * Step 2: a human reviews and explicitly confirms the exact spans, and a new
 * version with those spans permanently removed is produced in the same call
 * — there is no separate, un-reviewed "confirmed" state to leave hanging.
 * Needs documents.approve (the same decision right that gates lifting a
 * privilege tag — see updateDocumentGroup in ../store/service.ts), since
 * this is just as irreversible.
 */
export async function confirmAndApplyRedaction(tx: TenantTx, ctx: Ctx, redactionId: string, input: ConfirmRedactionInput): Promise<ConfirmRedactionResult> {
  const { tenantId, viewer } = ctx;
  if (!viewer.permissions.includes("documents.approve")) {
    throw new DocumentError("Only an attorney can confirm and apply a redaction.", 403);
  }
  const reason = input.reason?.trim();
  if (!reason) throw new DocumentError("A reason is required to apply a redaction.", 422);
  if (!input.confirmedSpans?.length) throw new DocumentError("At least one confirmed span is required.", 422);

  const [r] = await tx
    .select()
    .from(documentRedactions)
    .where(and(eq(documentRedactions.tenantId, tenantId), eq(documentRedactions.id, redactionId)))
    .for("update")
    .limit(1);
  if (!r) throw new NotFoundError("Redaction suggestion");
  if (r.status !== "suggested") throw new DocumentError(`This redaction suggestion is already '${r.status}'.`, 409);

  const [g] = await tx
    .select()
    .from(documentGroups)
    .where(and(eq(documentGroups.tenantId, tenantId), eq(documentGroups.id, r.groupId)))
    .for("update")
    .limit(1);
  if (!g) throw new NotFoundError("Document");
  if (g.currentDocumentId !== r.sourceDocumentId) {
    throw new DocumentError("A newer version exists since this redaction was suggested; generate a new suggestion.", 409);
  }
  const [cur] = await tx.select().from(documents).where(eq(documents.id, r.sourceDocumentId)).limit(1);
  if (!cur) throw new NotFoundError("Document");
  const decision = decideDocumentAccess(viewer, "edit", { matterId: g.matterId, privilegeTag: cur.privilegeTag, clientVisible: cur.clientVisible }, ctx.access);
  if (!decision.allowed) throw new DocumentError("You cannot change this document.", 403, { reason: decision.reason });

  if (!cur.mimeType || !REDACTABLE_MIME_TYPES.has(cur.mimeType)) {
    throw new DocumentError(
      `Redaction is only supported for plain-text documents right now (this version is '${cur.mimeType ?? "unknown"}'); PDF/Word/image redaction is a planned follow-up.`,
      422
    );
  }

  const [text] = await tx.select().from(documentText).where(eq(documentText.documentId, cur.id)).limit(1);
  if (!text || text.status !== "extracted") throw new DocumentError("This document's text is not available right now.", 409);
  if (textSha256(text.content) !== r.textSha256) {
    throw new DocumentError("This document's text has changed since this suggestion was made; generate a new suggestion.", 409);
  }

  // Rebuild as plain {start,end,category} objects — never trust or persist whatever
  // other fields a caller's span objects happen to carry (e.g. a UI's preview text).
  const confirmedSpans: RedactionSpan[] = input.confirmedSpans.map((s) => ({ start: s.start, end: s.end, category: s.category }));
  const suggested = new Set(r.suggestedSpans.map(spanKey));
  for (const s of confirmedSpans) {
    if (!suggested.has(spanKey(s))) {
      throw new DocumentError("A confirmed span must be one of this suggestion's spans; no new spans may be added here.", 422);
    }
  }
  const problems = validateSpans(text.content.length, confirmedSpans);
  if (problems.length > 0) throw new DocumentError(`Invalid confirmed spans: ${problems[0]!.message}`, 422);

  const now = ctx.now ?? new Date();
  const redactedBytes = new TextEncoder().encode(applyRedactionSpans(text.content, confirmedSpans));
  const sha256 = sha256Hex(redactedBytes);
  const documentId = randomUUID();
  const version = g.latestVersion + 1;
  const key = storageKeyFor({ tenantId, matterId: g.matterId, groupId: g.groupDocumentId, version, objectId: documentId });

  const adapters = gatedAdapters(tenantId, ctx.adapters);
  const put = await adapters.storage.put(key, redactedBytes, { contentType: cur.mimeType, sha256 });
  let scan: { status: string; detail?: string };
  try {
    scan = await adapters.scanner.scan(redactedBytes, { contentType: cur.mimeType, sha256 });
  } catch (err) {
    scan = { status: "error", detail: (err as Error).message };
  }

  await tx.insert(documents).values({
    id: documentId,
    tenantId,
    matterId: g.matterId,
    documentType: cur.documentType,
    storageKey: key,
    uploadedByUserId: viewer.userId,
    name: cur.name,
    version,
    versionGroupId: g.groupDocumentId,
    status: "uploaded",
    privilegeTag: cur.privilegeTag,
    // A redacted version is never auto-shared, whatever the previous version was: staff must explicitly re-share (c88 default-excluded rule).
    clientVisible: false,
    mimeType: cur.mimeType,
    sizeBytes: redactedBytes.length,
    sha256,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(documentVersionFiles).values({
    tenantId,
    documentId,
    storageAdapter: adapters.storage.name,
    storageKey: key,
    sha256,
    sizeBytes: redactedBytes.length,
    detectedMimeType: cur.mimeType,
    declaredMimeType: cur.mimeType,
    originalFilename: cur.name,
    encryption: put.encryption,
    scanStatus: scan.status,
    scanDetail: scan.detail ?? null,
    scannedAt: scan.status === "not_scanned" ? null : now,
    quarantinedAt: scan.status === "infected" ? now : null,
  });
  if (!["filed", "superseded", "archived"].includes(cur.status)) {
    await tx.update(documents).set({ status: "superseded", updatedAt: now }).where(eq(documents.id, cur.id));
  }
  await tx.update(documentGroups).set({ currentDocumentId: documentId, latestVersion: version, updatedAt: now }).where(eq(documentGroups.id, g.id));
  await tx.insert(documentText).values({
    tenantId,
    documentId,
    matterId: g.matterId,
    groupId: g.id,
    title: g.title,
    status: scan.status === "infected" ? "blocked" : "pending",
    detail: scan.status === "infected" ? "Quarantined file: not indexed." : null,
  });
  // Re-extract from the redacted bytes (rather than hand-writing documentText) so truncation / normalisation
  // stay exactly as consistent as any other version's — see ../extraction/service.ts.
  if (scan.status !== "infected") {
    await indexVersionText(tx, tenantId, documentId, ctx.settings, { adapters: ctx.adapters, bytes: redactedBytes, now });
  }

  const categories = [...new Set(confirmedSpans.map((s) => s.category))];
  await tx
    .update(documentRedactions)
    .set({
      status: "applied",
      confirmedSpans,
      confirmedByUserId: viewer.userId,
      confirmedAt: now,
      reason,
      redactedDocumentId: documentId,
      appliedAt: now,
    })
    .where(eq(documentRedactions.id, r.id));

  await audit(tx, {
    tenantId,
    engine: ENGINE,
    action: "document.redaction.applied",
    entityType: "document",
    entityId: documentId,
    matterId: g.matterId,
    actor: actorOf(viewer),
    reason,
    payload: { redactionId: r.id, sourceDocumentId: cur.id, redactedDocumentId: documentId, spanCount: confirmedSpans.length, categories },
  });
  await logAccess(tx, {
    tenantId,
    viewer,
    action: "redaction",
    outcome: "allowed",
    documentId,
    groupId: g.id,
    matterId: g.matterId,
    detail: { redactionId: r.id, sourceDocumentId: cur.id, spanCount: confirmedSpans.length, categories, reason },
  });

  return { redactionId: r.id, groupId: g.id, sourceDocumentId: cur.id, redactedDocumentId: documentId, version, spanCount: confirmedSpans.length, categories };
}

/** Step 3 (alternative to confirming): a human declines everything the heuristic pass found. */
export async function rejectRedactionSuggestion(tx: TenantTx, ctx: Ctx, redactionId: string, reason: string): Promise<{ redactionId: string; status: "rejected" }> {
  const { tenantId, viewer } = ctx;
  if (!viewer.permissions.includes("documents.approve")) {
    throw new DocumentError("Only an attorney can decline a redaction suggestion.", 403);
  }
  const trimmed = reason?.trim();
  if (!trimmed) throw new DocumentError("A reason is required.", 422);
  const [r] = await tx
    .select()
    .from(documentRedactions)
    .where(and(eq(documentRedactions.tenantId, tenantId), eq(documentRedactions.id, redactionId)))
    .for("update")
    .limit(1);
  if (!r) throw new NotFoundError("Redaction suggestion");
  if (r.status !== "suggested") throw new DocumentError(`This redaction suggestion is already '${r.status}'.`, 409);

  const now = ctx.now ?? new Date();
  await tx.update(documentRedactions).set({ status: "rejected", rejectedAt: now, reason: trimmed }).where(eq(documentRedactions.id, r.id));
  await audit(tx, {
    tenantId,
    engine: ENGINE,
    action: "document.redaction.rejected",
    entityType: "document",
    entityId: r.sourceDocumentId,
    matterId: r.matterId,
    actor: actorOf(viewer),
    reason: trimmed,
    payload: { redactionId: r.id },
  });
  return { redactionId: r.id, status: "rejected" };
}
