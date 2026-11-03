import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryApprovalSource, PendingApprovalError, refreshApprovals, resetApprovalStateForTests, setApprovalSource } from "@/compliance/approvals";
import { VENDOR_GATES } from "../gates";
import { UnavailableEfilingAdapter, getEfilingAdapter, setEfilingAdapter, type EfilingAdapter } from "./adapter";

describe("UnavailableEfilingAdapter", () => {
  beforeEach(() => resetApprovalStateForTests());
  afterEach(() => resetApprovalStateForTests());

  it("fails closed through vendor.efiling while the gate is pending", async () => {
    const adapter = new UnavailableEfilingAdapter();
    await expect(adapter.submit({ tenantId: "t1", filingId: "f1", court: "Travis County District Court", filingType: "petition" })).rejects.toBeInstanceOf(
      PendingApprovalError
    );
  });

  it("is the default adapter until a real one is wired in", () => {
    expect(getEfilingAdapter()).toBeInstanceOf(UnavailableEfilingAdapter);
  });
});

describe("setEfilingAdapter / getEfilingAdapter", () => {
  afterEach(() => setEfilingAdapter(null));

  it("swaps in a real adapter and back out to the unavailable default", async () => {
    const stub: EfilingAdapter = {
      name: "acme-efile",
      async submit() {
        return { vendorFilingId: "ACME-1" };
      },
    };
    setEfilingAdapter(stub);
    expect(getEfilingAdapter()).toBe(stub);
    expect(await getEfilingAdapter().submit({ tenantId: "t1", filingId: "f1", court: "x", filingType: "motion" })).toEqual({ vendorFilingId: "ACME-1" });

    setEfilingAdapter(null);
    expect(getEfilingAdapter()).toBeInstanceOf(UnavailableEfilingAdapter);
  });

  it("once approved, requireApproval no longer blocks (the unavailable adapter still has no vendor behind it)", async () => {
    resetApprovalStateForTests();
    const src = new InMemoryApprovalSource();
    src.approve({ gateKey: VENDOR_GATES.efiling.key, reviewerKind: "vendor_dpa", approvedByName: "Test" });
    setApprovalSource(src);
    await refreshApprovals();
    const adapter = new UnavailableEfilingAdapter();
    await expect(adapter.submit({ tenantId: "t1", filingId: "f1", court: "x", filingType: "other" })).rejects.toThrow("no e-filing vendor configured");
    resetApprovalStateForTests();
  });
});
