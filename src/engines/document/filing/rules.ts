// c86 — Document engine · file documents with the court and track service.
// Pure decision logic: no DB, no vendor. ./service.ts owns the database
// operations and ./adapter.ts owns the vendor seam.
//
// A filing only moves once a lawyer has approved the document version being
// filed (ENVELOPE_ELIGIBLE_DOCUMENT_STATUSES in ../signature/service.ts uses
// the same value) — this file reuses that fact, never a value of its own,
// and the pre-filing client sign-off c41 may require happens upstream of
// that approval, so there is nothing further to check here. The real
// e-filing vendor call is gated on vendor.efiling (./adapter.ts); nothing in
// this file talks to a court.

export const FILING_TYPES = ["petition", "motion", "response", "notice", "other"] as const;
export type FilingType = (typeof FILING_TYPES)[number];

export const FILING_STATUSES = ["draft", "submitted", "accepted", "rejected"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];

export const SERVICE_METHODS = ["efiling", "mail", "certified_mail", "personal", "other"] as const;
export type ServiceMethod = (typeof SERVICE_METHODS)[number];

export const SERVICE_STATUSES = ["pending", "completed", "failed"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** Only an approved document version may be filed — the same bar c4 sets for a signature envelope. */
export const FILING_ELIGIBLE_DOCUMENT_STATUSES = ["attorney_approved"] as const;

export interface Decision {
  allowed: boolean;
  reason?: string;
}

const ok: Decision = { allowed: true };
const no = (reason: string): Decision => ({ allowed: false, reason });

/** Submitting to the vendor requires a draft filing against an approved document version. */
export function canSubmitFiling(filingStatus: FilingStatus, documentStatus: string): Decision {
  if (filingStatus !== "draft") return no(`Filing is '${filingStatus}', not a draft.`);
  if (!(FILING_ELIGIBLE_DOCUMENT_STATUSES as readonly string[]).includes(documentStatus)) {
    return no(`Document is '${documentStatus}', not attorney-approved.`);
  }
  return ok;
}

/** The court's decision (accepted / rejected) may be recorded only once, while the filing is 'submitted'. */
export function canRecordDecision(filingStatus: FilingStatus): Decision {
  return filingStatus === "submitted" ? ok : no(`Filing is '${filingStatus}', not awaiting a decision.`);
}

/** Service on another party is tracked only once the court has accepted the filing. */
export function canRecordService(filingStatus: FilingStatus): Decision {
  return filingStatus === "accepted" ? ok : no(`Filing is '${filingStatus}', not accepted — nothing to serve yet.`);
}

/** The court-stamped copy can only be attached to an accepted filing. */
export function canAttachStampedCopy(filingStatus: FilingStatus): Decision {
  return filingStatus === "accepted" ? ok : no(`Filing is '${filingStatus}', not accepted — no stamped copy yet.`);
}

/**
 * A rejected filing is never resubmitted in place (c86 open question:
 * rejections mean new paperwork, not a retry) — the lawyer corrects the
 * document and opens a new filing against the new, re-approved version.
 * This is a documentation function, not a gate: service.ts simply has no
 * "resubmit" operation, so there is nothing to call once a filing is
 * 'rejected'.
 */
export function isTerminal(filingStatus: FilingStatus): boolean {
  return filingStatus === "rejected";
}
