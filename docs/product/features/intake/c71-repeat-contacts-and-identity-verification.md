# c71 — Spot repeat contacts and confirm identity before sharing anything

Status: first code slice shipped (this PR). Security card, Intake engine group, P1.

## Summary

Two related safety properties for intake:

1. **Repeat-contact detection.** When a new intake session arrives, check whether the person is likely someone the firm already has a `parties` record for (a past client, a past inquiry, a referral source). If so, queue a suggestion for staff to confirm or reject — never merge or link automatically.
2. **Identity verification before sharing.** Before any matter information is read out or sent over phone, SMS or email, confirm the person on the other end is actually who they claim to be — either because they are logged into the client portal, or because they correctly entered a one-time code sent to a contact method **already on file** for that party. A code is never sent to a number or address the caller is merely claiming is theirs.

Both properties protect the same thing from two directions: (1) avoids a duplicate record when the same real person returns through a different channel, and (2) avoids disclosing one real person's matter details to someone who is impersonating them (a different household member, an ex-spouse, a collections caller, etc.).

## Users / problem

Staff doing intake triage, and the automated intake channels (web chat, phone AI, email auto-reply) acting on their behalf. The problem: a firm's `parties` table accumulates duplicate records as the same person contacts the firm by phone, then email, then web chat — and separately, any channel that reads out matter status over the phone or by text is an easy target for someone pretending to be the client to extract information they are not entitled to.

## Scope — in this slice

- Pure, fully-unit-tested scoring logic for "is this new contact probably an existing party" (`src/engines/intake/identity/matching.ts`).
- A service layer that runs that scoring against the tenant's existing parties, queues `pending` suggestions, and lets staff `confirm` (moves the session's party pointer) or `reject` (requires a reason) — never merges or edits `parties` rows (`src/engines/intake/identity/service.ts`: `findDuplicateCandidates`, `confirmMatch`, `rejectMatch`).
- Pure, fully-unit-tested logic for one-time-code expiry/attempts/constant-time comparison and the actual "may information be shared right now" decision (`src/engines/intake/identity/verification.ts`).
- A service layer that resolves the caller's stated contact value against what is on file, generates and hashes a code, dispatches it through a vendor-adapter seam, and verifies a code the caller reads back (`requestVerificationCode`, `verifyCode`, `decideSharing` in `service.ts`).
- Two new engine-local tables: `intake_contact_match_suggestions`, `intake_identity_verifications` (`src/db/tables/intake.ts`).
- One new approval gate for the one-time-code wording (`src/engines/intake/gates.ts`: `IDENTITY_COPY.oneTimeCode`, key `copy.intake.identity_one_time_code`).

## Scope — explicitly **not** in this slice

- **Routes and staff/admin UI.** No API routes or screens are added here; `service.ts`'s exported functions are the integration surface for a follow-up PR.
- **A real SMS/email vendor.** `OtpDispatchAdapter` / `UnavailableOtpAdapter` mirror c4's `EnvelopeDispatchAdapter` pattern exactly: every dispatch fails closed through `vendor.sms` / `vendor.email` until a real adapter is wired with `setOtpAdapter()`.
- **Wiring into `src/core/notify.ts`'s `enqueueNotification()`.** That mechanism's client-facing payload is deliberately ids-only (`CLIENT_PAYLOAD_ALLOWED_KEYS`) and its wording variables are system-resolved (firm name, portal URL) — a one-time code is secret, one-off content that path was not built to carry. This PR dispatches through its own adapter seam instead, and the `notify.ts` integration gap is left as a named follow-up rather than forcing a fit.
- **Firm-settings-driven code length / expiry / attempt caps.** `DEFAULT_CODE_LENGTH`, `DEFAULT_CODE_EXPIRY_MINUTES`, `DEFAULT_MAX_ATTEMPTS`, `DEFAULT_VERIFICATION_FRESHNESS_MINUTES` are hard-coded exported constants in `verification.ts`, the same approach c4's `envelope.ts` took for its own expiry/reminder defaults — editing `src/engines/intake/settings.ts` (which has its own extensive, un-runnable-here test suite) was judged too risky without the ability to run tests locally in this sandbox.
- **"Links family members or businesses without merging them."** The card's text covers two distinct capabilities: suggesting duplicate individuals (built here) and linking *related but distinct* parties — a spouse, a child, a co-defendant's business — without treating them as the same person. This slice does **not** add a dedicated service for the second half. The primitives it would build on (`parties.parentPartyId`, `matterParties.relationship`) already exist in the shared schema, but no c71 code here reads or writes them. This is a real gap in this slice, not an oversight to be assumed away — flagged explicitly for the next PR against this card.
- **A real indexed SQL duplicate-match prefilter.** `parties.phone` has no normalized column today (unlike `normalizedName`/`normalizedAliases`, which are indexed). `findDuplicateCandidates` instead scans the tenant's `MAX_CANDIDATE_SCAN = 1000` most-recently-touched parties and lets the pure scorer do the comparison in application code. A `normalizedPhone` column on `parties` would let this be a real indexed query; that is a shared-schema change outside this engine's authority (flagged in the table file's MIGRATION NOTES item 5, not requested directly by this PR).
- **True party-record merging.** Confirming a suggestion only repoints the *current session's* `intake_session_state.partyId` — it never reassigns history, deletes a row, or merges two `parties` records. Real merging (reassigning matters, documents, consents, etc. from a duplicate record onto the canonical one) is a larger, riskier operation that more naturally belongs with the party-index foundation work referenced by the card itself ("Ties into the party index").

## Behaviour

### Duplicate detection

1. A new intake session arrives with a name and, usually, an email and/or phone (and sometimes a date of birth).
2. `findDuplicateCandidates` scores that contact against the tenant's existing `parties` rows using `matching.ts#scoreCandidate`:
   - **exact** — the incoming email or phone matches a value already on file for that party (checked against `email`/`phone` and the `emails`/`phones` arrays), regardless of whether the name matches. A hard-to-coincidentally-share identifier is enough on its own.
   - **likely** — the name matches (or matches a recorded alias/maiden name) **and** date of birth also matches, with no email/phone match.
   - **possible** — only the name (or an alias) matches. Common names collide, so this is a weak signal, but still worth a staff look rather than silently creating a duplicate record.
   - **none** — nothing meaningful lines up (date of birth alone, with no name match, is not treated as a signal — shared households and typos make it too noisy).
3. Every match above `none` is queued as a `pending` row in `intake_contact_match_suggestions` (one row per session+candidate pair; a repeat scoring run leaves an existing decision alone via `onConflictDoNothing`).
4. Staff review the queue (future PR's UI) and either:
   - **Confirm** (`confirmMatch`) — the suggestion is marked `confirmed` and the *session's* `intake_session_state.partyId` is pointed at the existing party. The `parties` rows themselves are never touched.
   - **Reject** (`rejectMatch`) — marked `rejected`, with a required reason. These are two different people.
5. Every scoring run, confirmation and rejection is audited (`intake.identity.duplicates_found` / `match_confirmed` / `match_rejected`).

### Identity verification before sharing

1. Before any matter information is shared over a channel, the caller is either already portal-authenticated, or must prove they are the party on file.
2. `requestVerificationCode` only ever sends a code to a contact value that is **already on file** for that party (`resolveOnFileContactValue` checks the caller's stated value, normalised, against the party's primary and secondary email/phone fields). If the stated value is not on file, the request is refused outright — no code is generated or sent anywhere.
3. A 6-digit code (configurable length, see "not in this slice") is generated with `node:crypto.randomInt`, hashed with a random salt (`sha256(code:salt)`), and stored — the plaintext code is never persisted. It expires after 10 minutes by default and allows 5 attempts by default.
4. The code is dispatched through the `OtpDispatchAdapter` seam (`vendor.sms`/`vendor.email` gated — fails closed with a visible placeholder until a real adapter is wired).
5. `verifyCode` enforces expiry and the attempt cap (`decideAttemptAllowed`), compares the submitted code to the stored hash in constant time (`codesMatch`), and marks the row `verified` or increments `attempts` (moving to `failed` once the cap is hit).
6. `decideSharing` is the actual point-of-use gate: portal login always satisfies it; otherwise the most recent verification for that party must be `verified`, on the **same channel**, against the **same on-file contact value**, and recent enough (30 minutes by default) — a code verified yesterday, or on a different channel, does not quietly authorise today's disclosure. Every call is audited as `sharing_allowed` or `sharing_blocked`, whichever way it goes.

## Business rules

- A suggested match is **never** acted on automatically, at any confidence level, including `exact`. Staff always click confirm or reject (card: "never auto-merges two different people").
- A one-time code is **never** sent to a contact value the caller is merely asserting — only to one already associated with the party (the core anti-impersonation property).
- A verification only covers sharing on the **same channel and same contact value** it was issued for; it does not generally authorise the party for all channels indefinitely.
- Rejecting a suggested match requires a staff-supplied reason (no silent dismissals) — same pattern used elsewhere in this engine (e.g. emergency downgrades, consultation cancellations).

## Data model touchpoints

- New: `intake_contact_match_suggestions` (tenant, session, matched party, confidence/matchedFields/score, status, reviewer, rejection reason).
- New: `intake_identity_verifications` (tenant, party, session, channel, method, contact value used, code hash/salt, status, attempts, expiry).
- Read-only: `parties` (email, phone, emails[], phones[], fullName, normalizedName, aliases[], normalizedAliases[], dateOfBirth) — never written to by this slice.
- Written: `intake_session_state.partyId` — the only existing row this slice ever mutates, and only via a staff-confirmed match.

## Notifications / visibility

- The one-time code message is the only new client-facing copy (`IDENTITY_COPY.oneTimeCode`, gate `copy.intake.identity_one_time_code`) — pending attorney review like every other gate in this engine; until approved, dispatch still runs (so the sandbox/dev flow works end-to-end) but the rendered text is the visible `[PENDING ATTORNEY REVIEW …]` placeholder, and the underlying SMS/email send itself is separately blocked by the vendor gate until a real adapter is configured.
- No new generic notification template is used; this is deliberate (see "not in this slice" re: `notify.ts`).

## Dependencies

- `c65` (omnichannel intake record) — c71 is listed as a dependency in `docs/product/features/intake/README.md`'s acceptance criteria (sessions from different channels for the same person should surface a c71 suggestion).
- `c56` (party index, referenced by the card as "ties into") — out of scope here; this slice's "confirm" action is deliberately narrow (session pointer only) so it does not pre-empt whatever record-merging design c56 settles on.
- `c4` (e-signature/engagement letters, this run's other card) — the `OtpDispatchAdapter`/`UnavailableOtpAdapter` pattern here is a direct copy of c4's `EnvelopeDispatchAdapter`/`UnavailableEnvelopeAdapter` seam, for consistency across the codebase.

## Compliance flags

- `copy.intake.identity_one_time_code` (new, attorney review) — the one-time-code message wording.
- `vendor.sms`, `vendor.email` (existing, shared) — gate actual dispatch of the code until a real vendor is configured.

## Verification notes (sandbox limitations)

This sandbox cannot run `npm install`, `npm test`, `npm run typecheck` or `npm run lint` (`gh auth status` / `gh repo clone` fail here), so none of the above was exercised locally. Every new file was instead hand-verified line-by-line against the real `main` source of every module it imports from (`src/db/schema.ts`, `src/core/index.ts`, `src/core/audit.ts`, `src/compliance/approvals.ts`, `src/compliance/gates.ts`, `src/engines/intake/common/{actors,errors,context}.ts`, `src/engines/intake/settings.ts`, `src/engines/intake/gates.ts`, `src/db/tables/intake.ts`) read fresh via the GitHub API for this PR, including the exact gate-key regex and uniqueness checks enforced by `src/engines/intake/gates.test.ts`. **Please treat CI's typecheck/lint/test run on this PR as the first real verification these files have had**, and flag anything that fails rather than assuming the above review caught everything a compiler would.

## Open questions

1. Should an `exact` match (email or phone alone) short-circuit straight to a stronger staff prompt (e.g. a blocking modal) rather than sitting in the same queue as a `possible` match? This slice treats all three confidence tiers identically from staff's point of view — they are just sorted by score.
2. Should a `rejected` suggestion ever be reconsidered (e.g. if the same pair is suggested again from a different session with new evidence)? Today the unique index on `(tenant, session, matched_party)` means a *different* session scores independently, but the same session+candidate pair is permanently settled once reviewed.
3. Who decides the eventual `normalizedPhone` column request on `parties` (c56's owner? a shared foundation request?) — flagged here but not filed as a separate card by this run.
4. Should `decideSharing`'s 30-minute freshness window be per-channel-configurable by firm settings once settings.ts changes are judged safe to make? (Same follow-up as the other OTP defaults.)
