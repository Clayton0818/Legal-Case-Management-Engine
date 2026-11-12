import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetApprovalStateForTests, setApprovals } from "@/compliance/approvals";
import { VENDOR_GATES } from "@/compliance/gates";
import {
  AccountingExportError,
  planExportBatches,
  StubAccountingExportAdapter,
  toCsv,
  toCsvLine,
  validateExportRow,
  type ExportRow,
} from "./accountingExport";

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    scope: "operating",
    externalAccountRef: "qbo-operating-1",
    date: "2026-11-01",
    description: "Invoice #42 payment",
    amountCents: 12_345n,
    category: "income",
    matterId: "m1",
    externalId: "inv-42",
    ...overrides,
  };
}

describe("validateExportRow", () => {
  it("accepts a well-formed row", () => {
    expect(validateExportRow(row())).toEqual([]);
  });

  it("rejects an unknown scope", () => {
    expect(validateExportRow(row({ scope: "whatever" as never }))).toEqual(expect.arrayContaining([expect.stringMatching(/Unknown scope/)]));
  });

  it("rejects a missing external account ref", () => {
    expect(validateExportRow(row({ externalAccountRef: "  " }))).toEqual(expect.arrayContaining([expect.stringMatching(/externalAccountRef/)]));
  });

  it("rejects a malformed date", () => {
    expect(validateExportRow(row({ date: "11/01/2026" }))).toEqual(expect.arrayContaining([expect.stringMatching(/YYYY-MM-DD/)]));
  });

  it("rejects a zero amount", () => {
    expect(validateExportRow(row({ amountCents: 0n }))).toEqual(expect.arrayContaining([expect.stringMatching(/cannot be zero/)]));
  });

  it("rejects an empty description or category", () => {
    expect(validateExportRow(row({ description: "" }))).toEqual(expect.arrayContaining([expect.stringMatching(/description/)]));
    expect(validateExportRow(row({ category: "" }))).toEqual(expect.arrayContaining([expect.stringMatching(/category/)]));
  });
});

describe("planExportBatches — the trust-never-mixed-with-operating rule", () => {
  it("never puts a trust row and an operating row in the same batch", () => {
    const batches = planExportBatches([
      row({ scope: "operating", externalAccountRef: "qbo-operating-1" }),
      row({ scope: "trust", externalAccountRef: "qbo-trust-1", amountCents: 5_000n, category: "deposit" }),
    ]);
    expect(batches).toHaveLength(2);
    const scopes = batches.map((b) => b.scope).sort();
    expect(scopes).toEqual(["operating", "trust"]);
    for (const batch of batches) {
      expect(new Set(batch.rows.map((r) => r.scope)).size).toBe(1);
    }
  });

  it("gives two trust accounts their own separate batches, never merged", () => {
    const batches = planExportBatches([
      row({ scope: "trust", externalAccountRef: "trust-account-A", amountCents: 1_000n, category: "deposit" }),
      row({ scope: "trust", externalAccountRef: "trust-account-B", amountCents: 2_000n, category: "deposit" }),
    ]);
    expect(batches).toHaveLength(2);
    expect(batches.map((b) => b.externalAccountRef).sort()).toEqual(["trust-account-A", "trust-account-B"]);
  });

  it("sums a batch's rows correctly, exactly (bigint, no floats)", () => {
    const batches = planExportBatches([
      row({ amountCents: 1_050n }),
      row({ amountCents: 2_025n }),
      row({ amountCents: -75n }),
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.totalCents).toBe(3_000n);
  });

  it("refuses the whole call if any row is invalid — never silently drops a bad row", () => {
    expect(() => planExportBatches([row(), row({ amountCents: 0n })])).toThrow(AccountingExportError);
  });

  it("an empty list of rows is fine (nothing to export)", () => {
    expect(planExportBatches([])).toEqual([]);
  });
});

describe("CSV formatting", () => {
  it("escapes an embedded quote and comma in the description", () => {
    const line = toCsvLine(row({ description: 'Smith, "Jones" matter costs' }));
    expect(line).toContain('"Smith, ""Jones"" matter costs"');
  });

  it("formats the amount as an exact decimal string, never a float", () => {
    const line = toCsvLine(row({ amountCents: 123_456_789n }));
    expect(line.split(",")[3]).toBe("1234567.89");
  });

  it("renders a full batch with its header first", () => {
    const [batch] = planExportBatches([row(), row({ externalId: "inv-43", description: "Invoice #43" })]);
    const csv = toCsv(batch!);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("date,description,category,amount,matter_id,external_id");
    expect(lines).toHaveLength(3);
  });
});

describe("StubAccountingExportAdapter", () => {
  beforeEach(() => resetApprovalStateForTests());
  afterEach(() => resetApprovalStateForTests());

  const [batch] = planExportBatches([row()]);

  it("is blocked until the shared accounting-export vendor gate is approved (vendor_dpa + cpa)", async () => {
    const adapter = new StubAccountingExportAdapter();
    await expect(adapter.sync("t1", batch!)).rejects.toThrow(/pending/i);
    expect(adapter.recorded).toHaveLength(0);
  });

  it("stays blocked with only one of the two required reviewers approved", async () => {
    setApprovals([
      { gateKey: VENDOR_GATES.accountingExport.key, reviewerKind: "vendor_dpa", approvedByName: "Vendor Reviewer", approvedAt: new Date() },
    ]);
    const adapter = new StubAccountingExportAdapter();
    await expect(adapter.sync("t1", batch!)).rejects.toThrow(/pending/i);
  });

  it("records instead of sending once both reviewers have approved", async () => {
    setApprovals([
      { gateKey: VENDOR_GATES.accountingExport.key, reviewerKind: "vendor_dpa", approvedByName: "Vendor Reviewer", approvedAt: new Date() },
      { gateKey: VENDOR_GATES.accountingExport.key, reviewerKind: "cpa", approvedByName: "Firm CPA", approvedAt: new Date() },
    ]);
    const adapter = new StubAccountingExportAdapter();
    const result = await adapter.sync("t1", batch!);
    expect(result.rowCount).toBe(1);
    expect(result.scope).toBe("operating");
    expect(adapter.recorded).toHaveLength(1);
  });
});
