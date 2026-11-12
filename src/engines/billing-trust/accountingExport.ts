// c83 — export to the firm's accounting software (QuickBooks Online, Xero,
// or a plain CSV for everyone else). Pure domain logic + a stub export
// adapter only in this PR — the same scoping precedent c77/c78/c80/c81
// already used in this engine (see the header notes in payments.ts and
// timeEntries.ts): no new DB tables or API routes yet, since which
// accounting vendor the firm actually uses is itself gated on the shared
// vendor.accounting_export gate (src/compliance/gates.ts — reused, never
// redefined; vendor_dpa + cpa). This module decides WHAT rows should be
// grouped into WHICH export batch, and formats a batch as CSV; it never
// calls a real accounting API.
//
// The one rule everything below exists to protect (c83's own card text):
// "Trust transactions are exported as a separate trust account, never
// mixed with operating." Concretely: a single export batch never carries
// rows of more than one scope — planExportBatches() groups by (scope,
// externalAccountRef) before anything is formatted, so a batch spanning
// both scopes, or two different trust/operating accounts collapsed into
// one, cannot be constructed by accident.

import { requireApproval } from "@/compliance/approvals";
import { VENDOR_GATES } from "@/compliance/gates";
import { centsToDecimalString, type Cents } from "./money";

export class AccountingExportError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AccountingExportError";
  }
}

export const ACCOUNT_SCOPES = ["operating", "trust"] as const;
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];

export const ACCOUNTING_TARGETS = ["quickbooks_online", "xero", "csv"] as const;
export type AccountingTarget = (typeof ACCOUNTING_TARGETS)[number];

/**
 * One row to export. `category` is left as a plain string (e.g. an
 * operating "income" / "cost" / "payment", or one of the trust ledger's own
 * TransactionKind values from ./types.ts) rather than importing that union,
 * so this module can never drift out of sync with the ledger's vocabulary —
 * it only ever has to know which SCOPE a row belongs to, which the caller
 * (the future integration step, once a processor-equivalent accounting
 * vendor is chosen) is responsible for setting correctly.
 */
export interface ExportRow {
  scope: AccountScope;
  /** The firm's own external account code/id in the target system for this scope. Never shared across scopes. */
  externalAccountRef: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  description: string;
  amountCents: Cents;
  category: string;
  matterId?: string | null;
  /** Idempotency key for the source record (invoice id, trust transaction id, …). */
  externalId?: string | null;
}

export interface ExportBatch {
  scope: AccountScope;
  externalAccountRef: string;
  rows: ExportRow[];
  totalCents: Cents;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates one row before it may enter a batch. Pure. */
export function validateExportRow(row: ExportRow): string[] {
  const errors: string[] = [];
  if (!(ACCOUNT_SCOPES as readonly string[]).includes(row.scope)) errors.push(`Unknown scope '${row.scope}'.`);
  if (!row.externalAccountRef.trim()) errors.push("externalAccountRef is required.");
  if (!ISO_DATE.test(row.date)) errors.push("date must be 'YYYY-MM-DD'.");
  if (!row.description.trim()) errors.push("description is required.");
  if (row.amountCents === 0n) errors.push("amountCents cannot be zero.");
  if (!row.category.trim()) errors.push("category is required.");
  return errors;
}

/**
 * Groups rows into one batch per (scope, externalAccountRef) pair. A firm
 * using more than one account for the SAME scope (e.g. two trust accounts)
 * is legitimate — each becomes its own batch. What this makes structurally
 * impossible is one batch spanning two scopes: the grouping key always
 * includes scope, so a trust row and an operating row can never land in the
 * same ExportBatch, however the rows are ordered or merged upstream.
 */
export function planExportBatches(rows: readonly ExportRow[]): ExportBatch[] {
  const byKey = new Map<string, ExportRow[]>();
  for (const row of rows) {
    const errors = validateExportRow(row);
    if (errors.length > 0) throw new AccountingExportError("INVALID_ROW", `Invalid export row: ${errors.join(" ")}`);
    const key = `${row.scope}\u0000${row.externalAccountRef}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }
  const batches: ExportBatch[] = [];
  for (const [key, list] of byKey) {
    const [scope, externalAccountRef] = key.split("\u0000") as [AccountScope, string];
    const totalCents = list.reduce((sum, r) => sum + r.amountCents, 0n);
    batches.push({ scope, externalAccountRef, rows: list, totalCents });
  }
  return batches;
}

/** One line of a plain CSV export, in the order a bookkeeper expects. Pure. */
export function toCsvLine(row: ExportRow): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [row.date, esc(row.description), row.category, centsToDecimalString(row.amountCents), row.matterId ?? "", row.externalId ?? ""].join(",");
}

export const CSV_HEADER = "date,description,category,amount,matter_id,external_id";

/** A full CSV for one batch, header first. Pure. */
export function toCsv(batch: ExportBatch): string {
  return [CSV_HEADER, ...batch.rows.map(toCsvLine)].join("\n");
}

// ---------------------------------------------------------------------------
// Vendor adapter (vendor.accounting_export — reused from
// src/compliance/gates.ts; never redefined here). No real QuickBooks Online
// or Xero call in this PR: the only adapter below is the stub, which
// records instead of sending. The gate is checked on the adapter itself,
// not just at some call site, so the stub is never a way around the
// vendor_dpa + CPA review.
// ---------------------------------------------------------------------------

export interface SyncResult {
  scope: AccountScope;
  externalAccountRef: string;
  externalBatchRef: string;
  rowCount: number;
}

export interface AccountingExportAdapter {
  readonly name: string;
  readonly target: AccountingTarget;
  sync(tenantId: string, batch: ExportBatch): Promise<SyncResult>;
}

/** Records to an in-memory log instead of calling a real accounting API. */
export class StubAccountingExportAdapter implements AccountingExportAdapter {
  readonly name = "stub";
  readonly target: AccountingTarget = "csv";
  readonly recorded: Array<{ tenantId: string; batch: ExportBatch }> = [];

  async sync(tenantId: string, batch: ExportBatch): Promise<SyncResult> {
    requireApproval(VENDOR_GATES.accountingExport.key, {
      action: "billing-trust.accounting_export.sync",
      tenantId,
      detail: { scope: batch.scope, externalAccountRef: batch.externalAccountRef, rowCount: batch.rows.length },
    });
    this.recorded.push({ tenantId, batch });
    return {
      scope: batch.scope,
      externalAccountRef: batch.externalAccountRef,
      externalBatchRef: `stub_${this.recorded.length}`,
      rowCount: batch.rows.length,
    };
  }
}
