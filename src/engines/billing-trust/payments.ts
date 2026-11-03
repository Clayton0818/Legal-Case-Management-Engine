// Online payments (c80): card and bank payments through a trust-safe
// payment processor. Pure domain logic + a stub processor adapter only in
// this PR — no new tables or API routes yet, the same scoping c77, c78 and
// c81 already used in this engine (see the note at the top of
// timeEntries.ts). Wiring a real processor, the webhook route, and the
// actual trust-ledger/invoice posting is a follow-up integration step once
// a processor is chosen and the shared vendor.payment_processor gate
// (src/compliance/gates.ts) is approved by both a vendor/DPA reviewer and a
// CPA — this module only decides WHAT should happen once a payment settles,
// never how it gets wired into the database. Nothing here calls
// postTransaction() (ledgerService.ts) or touches an invoice row.
//
// The one rule everything below exists to protect (c80's card text):
// "the processor must keep trust and operating deposits separate and take
// its fees from the operating account only, never from trust money."
// Concretely: a payment destined for trust posts its FULL gross amount —
// the processor's fee is always a separate, operating-side cost, never
// netted out of what lands in trust. See planSettlement() and its test
// "never nets the processor fee out of a trust deposit" for exactly the
// mistake this is designed to make structurally impossible to make by
// accident (there is no code path that subtracts fee from the trust side).

import { requireApproval } from "@/compliance/approvals";
import { VENDOR_GATES } from "@/compliance/gates";
import { assertPositiveAmount, type Cents } from "./money";

export class PaymentError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export const PAYMENT_DESTINATIONS = ["trust", "operating"] as const;
export type PaymentDestination = (typeof PAYMENT_DESTINATIONS)[number];

/**
 * What the money is for.
 *  - retainer_deposit:      always trust (c50/c76).
 *  - invoice_payment:       always operating — the fees it pays were already
 *                           moved out of trust via earned_fee_transfer (c79).
 *  - fixed_fee_installment: always operating, per a fixed-fee pay schedule (c52).
 *  - consult_fee:           deliberately NOT fixed here — c67's booking card
 *                           leaves "operating vs trust destination" as an
 *                           open founder/CPA question (rules.intake.consult_fee_terms,
 *                           src/engines/intake/gates.ts BOOKING_RULE_GATES).
 *                           destinationForPurpose() below refuses to guess.
 */
export const PAYMENT_PURPOSES = ["retainer_deposit", "consult_fee", "invoice_payment", "fixed_fee_installment"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const PAYMENT_METHODS = ["card", "bank_transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Which ledger a purpose's money belongs in. Pure. */
export function destinationForPurpose(
  purpose: PaymentPurpose,
  consultFeeDestination?: PaymentDestination | null
): PaymentDestination {
  if (purpose === "retainer_deposit") return "trust";
  if (purpose === "invoice_payment" || purpose === "fixed_fee_installment") return "operating";
  if (!consultFeeDestination) {
    throw new PaymentError(
      "CONSULT_FEE_DESTINATION_UNSET",
      "A consultation fee's destination (trust or operating) is not set for this firm — see c67's open rules.intake.consult_fee_terms question. " +
        "This is deliberately never assumed."
    );
  }
  return consultFeeDestination;
}

export interface PaymentIntentInput {
  matterId: string;
  clientPartyId: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amountCents: Cents;
  /** Only meaningful (and only read) for purpose === "consult_fee". */
  consultFeeDestination?: PaymentDestination | null;
  /** Required for, and only valid for, purpose === "invoice_payment". */
  invoiceId?: string | null;
}

export interface PaymentIntent {
  purpose: PaymentPurpose;
  method: PaymentMethod;
  amountCents: Cents;
  destination: PaymentDestination;
  matterId: string;
  clientPartyId: string;
  invoiceId: string | null;
}

/** Validates and resolves a payment request into an intent, before any processor call. Pure. */
export function planPaymentIntent(input: PaymentIntentInput): PaymentIntent {
  const amountCents = assertPositiveAmount(input.amountCents, "amountCents");
  if (!input.matterId.trim()) throw new PaymentError("MATTER_REQUIRED", "matterId is required.");
  if (!input.clientPartyId.trim()) throw new PaymentError("CLIENT_REQUIRED", "clientPartyId is required.");
  if (input.purpose === "invoice_payment" && !input.invoiceId?.trim()) {
    throw new PaymentError("INVOICE_REQUIRED", "An invoice payment needs the invoice id it is paying.");
  }
  if (input.purpose !== "invoice_payment" && input.invoiceId) {
    throw new PaymentError("INVOICE_NOT_APPLICABLE", `invoiceId is only valid for 'invoice_payment', not '${input.purpose}'.`);
  }
  const destination = destinationForPurpose(input.purpose, input.consultFeeDestination);
  return {
    purpose: input.purpose,
    method: input.method,
    amountCents,
    destination,
    matterId: input.matterId,
    clientPartyId: input.clientPartyId,
    invoiceId: input.invoiceId ?? null,
  };
}

export interface ProcessorFee {
  /** The processor's cut of this payment. ALWAYS an operating-side cost — see the file header. */
  feeCents: Cents;
}

export interface SettlementPlan {
  /** The intent's full gross amount, unmodified by the fee. Null when destination is "operating" — nothing is posted to trust at all. */
  trustDepositCents: Cents | null;
  /** The intent's full gross amount when destination is "operating". Null when destination is "trust". */
  operatingReceiptCents: Cents | null;
  /** Carried separately; never subtracted from either amount above. */
  processorFeeCents: Cents;
}

/**
 * What should happen to the money once the processor confirms a payment
 * settled. Pure — never touches the database or the ledger itself; see the
 * file header for why, and for the invariant this exists to keep: whichever
 * side the money lands on gets the FULL amount the client paid, every time.
 */
export function planSettlement(intent: Pick<PaymentIntent, "destination" | "amountCents">, fee: ProcessorFee): SettlementPlan {
  if (fee.feeCents < 0n) throw new PaymentError("INVALID_FEE", "processorFeeCents cannot be negative.");
  if (fee.feeCents > intent.amountCents) {
    // A fee larger than the payment itself is always a data error (a real
    // processor's fee is a small percentage), never a reason to post a
    // negative or zero trust/operating amount.
    throw new PaymentError("FEE_EXCEEDS_AMOUNT", "processorFeeCents cannot exceed the payment's amountCents.");
  }
  return {
    trustDepositCents: intent.destination === "trust" ? intent.amountCents : null,
    operatingReceiptCents: intent.destination === "operating" ? intent.amountCents : null,
    processorFeeCents: fee.feeCents,
  };
}

// ---------------------------------------------------------------------------
// Processor adapter (vendor.payment_processor — reused from
// src/compliance/gates.ts per engines/README.md; never redefined here). No
// real processor is wired up in this PR: every call is gated, and the only
// adapter below is the stub, which records instead of sending.
// ---------------------------------------------------------------------------

export interface CreatePaymentRequest {
  tenantId: string;
  intent: PaymentIntent;
  /** Where the client is sent after paying (card) or shown instructions (bank transfer). The stub just echoes this back. */
  returnUrl: string;
}

export interface CreatedPayment {
  processorRef: string;
  /** Hosted payment page URL (card) or bank-transfer instructions reference. Real shape is processor-specific; TBD when one is chosen. */
  clientActionUrl: string;
  status: "requires_action" | "processing";
}

export interface SettledPaymentEvent {
  processorRef: string;
  amountCents: Cents;
  fee: ProcessorFee;
  settledAt: Date;
}

export interface PaymentProcessorAdapter {
  readonly name: string;
  createPayment(request: CreatePaymentRequest): Promise<CreatedPayment>;
  /** Parses and verifies a processor webhook payload into a settlement event, or null if it isn't one this adapter recognizes. */
  parseWebhookEvent(rawPayload: unknown): SettledPaymentEvent | null;
}

/**
 * Records to an in-memory log instead of calling a real processor
 * (engines/README.md: "Put the vendor behind an interface with a stub
 * adapter that records to the outbox or log instead of sending"). The gate
 * check happens here too, not just on a real adapter — the stub is never a
 * way to skip the DPA/CPA review, it only means nothing leaves the product
 * while that review is pending.
 */
export class StubPaymentProcessorAdapter implements PaymentProcessorAdapter {
  readonly name = "stub";
  readonly recorded: CreatePaymentRequest[] = [];

  async createPayment(request: CreatePaymentRequest): Promise<CreatedPayment> {
    requireApproval(VENDOR_GATES.paymentProcessor.key, {
      action: "billing-trust.payments.create_payment",
      tenantId: request.tenantId,
      detail: { purpose: request.intent.purpose, destination: request.intent.destination, method: request.intent.method },
    });
    this.recorded.push(request);
    return {
      processorRef: `stub_${this.recorded.length}`,
      clientActionUrl: request.returnUrl,
      status: "requires_action",
    };
  }

  parseWebhookEvent(_rawPayload: unknown): SettledPaymentEvent | null {
    // The stub never receives a real webhook; tests drive settlement
    // directly through planSettlement() instead of through this method.
    return null;
  }
}
