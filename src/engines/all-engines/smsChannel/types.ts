// c113 — two-way SMS/text channel: shared types between the webhook route
// and service.ts.

export interface InboundSmsInput {
  tenantId: string;
  /** The client's number, as the vendor sent it (any formatting). */
  from: string;
  /** The firm's SMS number the client texted. */
  to: string;
  body: string;
  /** Vendor message id (e.g. Twilio's MessageSid), for audit/dedupe. */
  providerMessageId: string | null;
}

export type InboundSmsOutcome =
  | { kind: "opted_out"; partyId: string }
  | { kind: "opted_in"; partyId: string }
  | { kind: "help_requested"; partyId: string; flagId: string }
  | { kind: "logged"; partyId: string; matterId: string | null; flagId: string }
  | { kind: "unmatched"; flagId: string };
