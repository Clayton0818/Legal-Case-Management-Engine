# c4 implementation notes — e-signature envelope, core slice

Implements the first code slice of the spec already on main
(`docs/product/features/document/c4-e-signature-and-engagement-letter-generation.md`):
the generic, multi-signer e-signature **envelope** capability that c39, c41,
c59 and c52 are meant to reuse, rather than each building their own
one-signer stub.

## What this adds

- **`src/engines/document/signature/envelope.ts`** (pure) — signing order
  (`nextSignerToAct`, `decideSignerAction`), completion (`isEnvelopeComplete`,
  `hasDecline`), the hash-binding check an envelope must pass to complete
  (`canCompleteAgainstHash`, spec §5 rule 1 / acceptance criterion 3), and
  expiry/reminder scheduling on the firm's business calendar
  (`defaultExpiryAt`, `reminderDates`, default 10 business days / 2 and 5,
  spec §5 rules 6–7). `prepareSigners` validates and numbers a signer list
  (exactly one of `partyId`/`userId` per signer, spec §6).
- **`src/engines/document/signature/service.ts`** — `createEnvelope` (drafts
  an envelope against one `attorney_approved` document version, binding it
  to that version's SHA-256), `sendEnvelope` (gated on `vendor.esignature`
  through a new `EnvelopeDispatchAdapter` seam — fails closed with a
  pending-approval placeholder exactly like c39's own
  `SignatureRequestAdapter`, since no vendor is wired yet),
  `recordSignerEvent` (viewed/signed/declined, enforcing signing order and
  the hash binding on 'signed'), `voidEnvelope` (attorney-only, with a
  reason), and `expireOverdueEnvelopes` (marks 'sent' envelopes past their
  expiry — acceptance criterion 6).
- **Tables** in `src/db/tables/document.ts`: `signature_envelopes`,
  `signature_signers`. MIGRATION NOTES item 9 covers RLS/GRANTs. **No
  migration generated**, per `src/engines/README.md`.
- **16 vitest tests** (`envelope.test.ts`) covering signing order, decline
  stopping the chain, the hash check, default expiry/reminder scheduling,
  and signer-spec validation.

## Verification

I could not run `npm run typecheck` / `eslint` / `vitest` against a live
clone of the repo this run (no local checkout available), so I read every
imported symbol and signature against the real files on `main` instead:
`src/db/schema.ts`, `src/db/tables/document.ts`, `src/core/index.ts` and
`src/core/businessHours.ts`, `src/core/audit.ts`,
`src/compliance/approvals.ts`, and the Document engine's own
`errors.ts`/`settings.ts`/`access/policy.ts`/`access/service.ts`/`gates.ts`
and the already-shipped `engagement/service.ts` / `review/service.ts` /
`delivery/service.ts` for the exact conventions (ctx shape, `requireWrite`,
`decideMatter`, `actorOf`, gated-adapter seam, audit payloads). I checked
every import in the new files resolves to a real, currently-exported symbol
with a matching signature, and left no unused imports. **Please still run
the CI typecheck/lint/test step before relying on this** — I'd normally
confirm it myself and did for every other PR this session; this one I could
not.

## Sources / basis

The c4 spec on main, `src/engines/document/README.md`-equivalent
(`src/engines/README.md`), `src/compliance/gates.ts` /
`src/engines/document/gates.ts` (`VENDOR_GATES.esignature`), and the shipped
c39/c41/c84/c85 code for conventions. No new legal claims are made (the
spec's Texas UETA research already stands), so no web research was needed
for this card.

## Not done here (follow-ups)

- Producing the signed PDF + completion certificate as a new `documents`
  version (c84) once an envelope completes — `recordSignerEvent`'s 'signed'
  branch marks the envelope `completed` but does not yet generate or store
  that output.
- Wiring a real vendor adapter (`setEnvelopeAdapter`) — open question 1 on
  the spec (buy vs. build) is still open.
- Wiring c39's own `SignatureRequestAdapter` (`engagement/service.ts`) to
  call through this generic envelope instead of its current one-signer
  stub, and the same for c41/c59/c52 once they need real e-signature rather
  than click-approval.
- Routes, admin/client UI, and a worker-tick hook that calls
  `expireOverdueEnvelopes()` and the reminder schedule on a cadence.
- Reading the firm's real business calendar (`getFirmSettings`) instead of
  the caller supplying a `BusinessCalendar` directly to `sendEnvelope`.

## Open questions for human review

Same three as the spec already lists (`docs/product/features/document/c4-*.md`
§11): buy vs. build the vendor, the exact "once Retained" trigger wording,
and the default identity-check level. Nothing new here.
