import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetApprovalStateForTests, setApprovals } from "@/compliance/approvals";
import { VENDOR_GATES } from "@/compliance/gates";
import {
  destinationForPurpose,
  planPaymentIntent,
  planSettlement,
  PaymentError,
  StubPaymentProcessorAdapter,
} from "./payments";

describe("destinationForPurpose", () => {
  it("retainer deposits always go to trust", () => {
    expect(destinationForPurpose("retainer_deposit")).toBe("trust");
  });

  it("invoice payments and fixed-fee installments always go to operating", () => {
    expect(destinationForPurpose("invoice_payment")).toBe("operating");
    expect(destinationForPurpose("fixed_fee_installment")).toBe("operating");
  });

  it("never guesses a consult fee's destination", () => {
    expect(() => destinationForPurpose("consult_fee")).toThrow(PaymentError);
    expect(() => destinationForPurpose("consult_fee", null)).toThrow(/open rules.intake.consult_fee_terms/);
  });

  it("uses the firm's recorded consult-fee destination once it's set", () => {
    expect(destinationForPurpose("consult_fee", "trust")).toBe("trust");
    expect(destinationForPurpose("consult_fee", "operating")).toBe("operating");
  });
});

describe("planPaymentIntent", () => {
  const base = { matterId: "m1", clientPartyId: "p1", method: "card" as const, amountCents: 10_000n };

  it("resolves a retainer deposit with no invoice id", () => {
    const intent = planPaymentIntent({ ...base, purpose: "retainer_deposit" });
    expect(intent.destination).toBe("trust");
    expect(intent.invoiceId).toBeNull();
  });

  it("requires an invoice id for invoice_payment", () => {
    expect(() => planPaymentIntent({ ...base, purpose: "invoice_payment" })).toThrow(/needs the invoice id/);
  });

  it("accepts an invoice id for invoice_payment and resolves to operating", () => {
    const intent = planPaymentIntent({ ...base, purpose: "invoice_payment", invoiceId: "inv1" });
    expect(intent.destination).toBe("operating");
    expect(intent.invoiceId).toBe("inv1");
  });

  it("rejects an invoice id for a purpose other than invoice_payment", () => {
    expect(() => planPaymentIntent({ ...base, purpose: "retainer_deposit", invoiceId: "inv1" })).toThrow(
      /only valid for 'invoice_payment'/
    );
  });

  it("rejects a non-positive amount", () => {
    expect(() => planPaymentIntent({ ...base, purpose: "retainer_deposit", amountCents: 0n })).toThrow();
    expect(() => planPaymentIntent({ ...base, purpose: "retainer_deposit", amountCents: -500n })).toThrow();
  });

  it("surfaces the same unset-consult-fee-destination error as destinationForPurpose", () => {
    expect(() => planPaymentIntent({ ...base, purpose: "consult_fee" })).toThrow(PaymentError);
  });
});

describe("planSettlement — the trust-safe fee rule", () => {
  it("posts the FULL gross amount to trust; the fee never reduces it", () => {
    const plan = planSettlement({ destination: "trust", amountCents: 100_000n }, { feeCents: 2_900n });
    expect(plan.trustDepositCents).toBe(100_000n);
    expect(plan.operatingReceiptCents).toBeNull();
    expect(plan.processorFeeCents).toBe(2_900n);
    // The regression this guards against: trustDepositCents must never equal
    // amount-minus-fee, however the implementation changes in the future.
    expect(plan.trustDepositCents).not.toBe(100_000n - 2_900n);
  });

  it("posts the full gross amount to operating when the destination is operating, fee carried separately", () => {
    const plan = planSettlement({ destination: "operating", amountCents: 50_000n }, { feeCents: 1_500n });
    expect(plan.operatingReceiptCents).toBe(50_000n);
    expect(plan.trustDepositCents).toBeNull();
    expect(plan.processorFeeCents).toBe(1_500n);
  });

  it("rejects a negative fee", () => {
    expect(() => planSettlement({ destination: "trust", amountCents: 1_000n }, { feeCents: -1n })).toThrow(PaymentError);
  });

  it("rejects a fee larger than the payment", () => {
    expect(() => planSettlement({ destination: "trust", amountCents: 1_000n }, { feeCents: 1_001n })).toThrow(
      /cannot exceed/
    );
  });

  it("a zero fee is fine (e.g. a bank transfer the firm absorbs)", () => {
    const plan = planSettlement({ destination: "trust", amountCents: 1_000n }, { feeCents: 0n });
    expect(plan.processorFeeCents).toBe(0n);
    expect(plan.trustDepositCents).toBe(1_000n);
  });
});

describe("StubPaymentProcessorAdapter", () => {
  beforeEach(() => resetApprovalStateForTests());
  afterEach(() => resetApprovalStateForTests());

  const intent = planPaymentIntent({
    matterId: "m1",
    clientPartyId: "p1",
    purpose: "retainer_deposit",
    method: "card",
    amountCents: 500_00n,
  });

  it("is blocked until the shared payment-processor vendor gate is approved (vendor_dpa + cpa)", async () => {
    const adapter = new StubPaymentProcessorAdapter();
    await expect(
      adapter.createPayment({ tenantId: "t1", intent, returnUrl: "https://example.com/return" })
    ).rejects.toThrow(/pending/i);
    expect(adapter.recorded).toHaveLength(0);
  });

  it("stays blocked with only one of the two required reviewers approved", async () => {
    setApprovals([
      { gateKey: VENDOR_GATES.paymentProcessor.key, reviewerKind: "vendor_dpa", approvedByName: "Vendor Reviewer", approvedAt: new Date() },
    ]);
    const adapter = new StubPaymentProcessorAdapter();
    await expect(adapter.createPayment({ tenantId: "t1", intent, returnUrl: "https://example.com/return" })).rejects.toThrow(
      /pending/i
    );
  });

  it("records instead of sending, once both reviewers have approved", async () => {
    setApprovals([
      { gateKey: VENDOR_GATES.paymentProcessor.key, reviewerKind: "vendor_dpa", approvedByName: "Vendor Reviewer", approvedAt: new Date() },
      { gateKey: VENDOR_GATES.paymentProcessor.key, reviewerKind: "cpa", approvedByName: "Firm CPA", approvedAt: new Date() },
    ]);
    const adapter = new StubPaymentProcessorAdapter();
    const created = await adapter.createPayment({ tenantId: "t1", intent, returnUrl: "https://example.com/return" });
    expect(created.status).toBe("requires_action");
    expect(created.clientActionUrl).toBe("https://example.com/return");
    expect(adapter.recorded).toHaveLength(1);
    expect(adapter.recorded[0]?.intent.destination).toBe("trust");
  });

  it("parseWebhookEvent is a no-op stub (no real processor wired up yet)", () => {
    const adapter = new StubPaymentProcessorAdapter();
    expect(adapter.parseWebhookEvent({ anything: "at all" })).toBeNull();
  });
});
