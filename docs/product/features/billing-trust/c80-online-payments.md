# c80 · Online card and bank payments through a trust-safe payment processor

**Card:** `c80` Billing & trust engine · Online card and bank payments through a trust-safe payment processor (Engineering, P1, backlog).
**Status:** Pure domain logic + a stub processor adapter in this PR, same scoping `c77`, `c78` and `c81` already used in this engine (see the note at the top of `timeEntries.ts`). No new tables, no API routes, no real processor, and nothing here posts to the trust ledger or an invoice yet — that's the follow-up integration step this doc's §4 describes.

## 1. What this PR adds

`src/engines/billing-trust/payments.ts` (+ `payments.test.ts`, 19 tests):

- `destinationForPurpose()` / `planPaymentIntent()` — pure rules for which ledger a payment belongs to: a retainer deposit always goes to trust; an invoice payment or a fixed-fee installment always goes to operating (the fees they pay were already moved out of trust via `earned_fee_transfer`, c79); a consultation fee's destination is **never guessed** — it comes from the firm's own answer to `c67`'s still-open `rules.intake.consult_fee_terms` question (`src/engines/intake/gates.ts`), and `destinationForPurpose("consult_fee")` throws rather than defaulting if that answer isn't supplied.
- `planSettlement()` — the one function the card's own text exists to protect: *"the processor must keep trust and operating deposits separate and take its fees from the operating account only, never from trust money."* Whichever side a payment lands on gets the full gross amount the client paid; the processor's fee is always carried as a separate field, never subtracted from it. `payments.test.ts` pins this down with an explicit regression test (`trustDepositCents` must never equal `amount - fee`), not just a happy-path assertion.
- `PaymentProcessorAdapter` + `StubPaymentProcessorAdapter` — the vendor interface `src/engines/README.md`'s approval-placeholders table calls for ("Put the vendor behind an interface with a stub adapter that records to the outbox or log instead of sending"). The stub's `createPayment()` is gated on the existing shared `vendor.payment_processor` gate (`src/compliance/gates.ts` — reused, not redefined; it already names `cardIds: ["c80", "c67", "c52"]` and requires both a `vendor_dpa` and a `cpa` reviewer) and records the request to an in-memory list instead of calling anything real. Nothing leaves the product until that gate is approved, same as every other vendor in this codebase.

## 2. Why no tables or routes yet

Two reasons, both precedent in this engine already:

1. **Product-parallel cards land as separate same-day PRs** (`CLAUDE.md`, 2026-10-01 rule) — each adds only new files under its own path so they don't race to edit the same shared engine files or each need their own migration. This run picked `c80` alongside `c36` (a different engine entirely), so the same discipline applies within `billing-trust`.
2. **There is no processor to integrate with yet.** The real webhook-handling route, the actual `postTransaction()` call (trust destination) or invoice-paid update (operating destination), and the migration for a `payments` table all depend on which processor gets chosen — that choice itself needs the `vendor.payment_processor` gate's `vendor_dpa` + `cpa` review, which is Clayton's and the firm's CPA's call, not this session's. Building the wiring against an imagined processor shape risks throwaway code; the rules and the stub adapter interface above are what's processor-agnostic and safe to commit to now.

## 3. Open questions (for Clayton / CPA review, not answered here)

1. **Consultation fee destination.** Already open on `c67` (`rules.intake.consult_fee_terms`) — `payments.ts` just makes the consequence of leaving it open explicit: `planPaymentIntent({ purpose: "consult_fee", ... })` throws until it's set.
2. **Which processor.** Determines the real `PaymentProcessorAdapter` implementation's shape (Stripe-style payment intents vs. a bank-transfer-only processor have different webhook/settlement semantics) and is gated on `vendor.payment_processor` (`vendor_dpa` + `cpa`).
3. **Where the processor's fee is actually booked.** `planSettlement()` carries `processorFeeCents` as data; this PR doesn't decide which operating-side account or cost category records it — that's a real accounting question for the CPA reviewer, not something to default silently.

## 4. Follow-up integration step (not this PR)

Once a processor is chosen and the vendor gate is approved: add the `payments` table to `src/db/tables/billing-trust.ts` (with its own `MIGRATION NOTES`), an `src/app/api/billing-trust/payments/**` route for creating a payment and a webhook route for settlement events, a real `PaymentProcessorAdapter` implementation, and the actual posting — `postTransaction()` (`ledgerService.ts`) for a `planSettlement().trustDepositCents` result, or marking the relevant invoice paid for an `operatingReceiptCents` result. None of that is guessed at here; `payments.ts`'s exports are written so that integration step can call straight into them without changing their behavior.

## 5. Verification

`npx tsc --noEmit`, `npx eslint .` and `npx vitest run` all pass locally against this branch (1357 tests passed, 15 skipped — the pre-existing DB-only tests that need `DATABASE_URL`), including the 19 new tests in `payments.test.ts`.
