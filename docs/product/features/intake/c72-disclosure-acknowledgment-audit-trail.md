# c72 · Disclosure & consent acknowledgment audit trail

**Card:** `c72` Intake engine · Show the required disclosures and capture consent before intake questions begin (Compliance, P1)

This note documents the engineering mechanism this card adds — the
audit trail that proves a disclosure or consent was shown and
acknowledged. It is not a full product spec (c65's spec already covers the
disclosure/consent *flow*; see `c65-omnichannel-intake-record.md` §4 and its
cross-references to c72), because this card's remaining scope, once c65
shipped, turned out to be narrowly the proof mechanism below rather than new
user-facing behavior.

c72 is the software side of c10's wording requirement: before any intake
questions, on every channel, the person is shown required disclosures (they
are talking to an automated assistant, no attorney-client relationship
exists yet, don't share confidential details yet, not for emergencies — call
911, a privacy notice) and asked for the separate consents that apply
(call-recording consent, a separate opt-in for text messages). c72's own job
is **not** to draft that wording — it is drafted already, pending attorney
review, in `src/engines/intake/gates.ts`'s `CHANNEL_COPY` (c65/c72) — c72's
job is to make sure the firm can **prove**, after the fact, exactly what a
given person was shown, in what language, on what channel, and when they
acknowledged it.

## What c65 already shipped (read this before changing anything here)

Most of the proof mechanism was already built as part of c65 ("intake from
every channel lands in one intake record"), because the two engines share
one need: every outbound disclosure/consent prompt has to be logged anyway
so the conversation can be replayed, and every acknowledgment has to be
logged anyway so case-detail questions can be locked until it happens
(`caseDetailsLock()` in `src/engines/intake/channels/records.ts`).

- **`intake_messages`** (`src/db/tables/intake.ts`) stores every outbound
  message's **literal rendered text** (`body`, with `{firmName}` /
  `{portalUrl}` already filled in, or the visible pending-review
  placeholder when the wording isn't approved yet), tagged with the
  `copy_gate_key` that produced it, the channel, and a timestamp. This is
  written by `deliverReplies()` in `src/engines/intake/channels/service.ts`
  for every disclosure, SMS first reply, recording prompt and email
  auto-reply the assistant sends.
- **`intake_consents`** (`src/db/tables/intake.ts`) stores the
  **acknowledgment itself**: one row per consent type (`disclosures`,
  `recording`, `sms`), the channel, the gate key, a version marker for the
  wording (the gate's draft hash when approved, `pending_review`
  otherwise), whether it was given, who recorded it (for staff-entered
  channels), and when. Written by `acknowledgeDisclosures()` and
  `recordConsent()` in the same file, and already wired into the one place
  that matters: `acknowledgeDisclosures()` is what sets
  `intake_session_state.disclosures_acknowledged_at`, the timestamp
  `caseDetailsLock()` gates case-detail questions on.

Between those two tables, the firm already has: which exact wording was
shown (the literal text, not just a hash), on which channel, and a separate,
timestamped row proving the person agreed to it — for the general
disclosure, the recording consent, and the SMS opt-in as three genuinely
separate acknowledgments, exactly as c72's note asks ("separate opt-in for
text messages").

## What this card adds

Three small, genuinely missing pieces, kept to `src/engines/intake/**` and
`src/db/tables/intake.ts`:

1. **`intake_consents.language`** (new column, `text not null default
   'en'`, `check (language in ('en','es'))`). Previously the language of
   the wording shown was only recoverable by parsing the `_es` suffix off
   `text_gate_key` (c36's bilingual gates double up every copy key:
   `copy.intake.channel_disclosure` vs `..._es`). That worked, but it meant
   every compliance query had to know the gate-key convention. The language
   is now its own column, set from the session's language at the moment of
   acknowledgment.
2. **`src/engines/intake/channels/acknowledgments.ts`** — pure, unit-tested
   functions that were previously inlined (and duplicated between
   `acknowledgeDisclosures()` and `recordConsent()`):
   - `buildAcknowledgmentRecord()` computes the `intake_consents` row to
     insert (the version-pinning logic: the gate's current draft hash when
     approved, `pending_review` otherwise) — one place instead of two.
   - `summarizeDisclosureProof()` joins a session's `intake_consents` rows
     with the matching `intake_messages` rows (same gate key, nearest
     message at or before the acknowledgment) into one ordered report: for
     each acknowledgment, the consent type, channel, language, whether it
     was given, when, and — new — the **literal text that was actually
     shown**, pulled back from `intake_messages.body` rather than only a
     hash. This is what lets a report say "here is the exact sentence this
     person read," not just "here is a fingerprint of some wording."
3. **`getDisclosureProof(tx, tenantId, intakeSessionId)`** in
   `src/engines/intake/channels/service.ts` — the query helper that had no
   reader before this card: it fetches a session's consents and outbound
   messages and calls `summarizeDisclosureProof()`. This is the piece that
   actually lets "the firm prove what the person saw" (c72's note) rather
   than that evidence existing in two tables with nothing that reads them
   together.

## What is still pending

The disclosure, recording-consent and SMS-opt-in **wording** is drafted but
not yet attorney-approved (`CHANNEL_COPY` and `CHANNEL_RULE_GATES` in
`src/engines/intake/gates.ts`, gates `copy.intake.channel_disclosure(_es)`,
`copy.intake.sms_first_reply(_es)`, `copy.intake.recording_consent_prompt(_es)`,
and the TCPA timing rule `rules.intake.sms_conversation_reply`). Until a
reviewer signs off, every person sees the visible
`[PENDING ATTORNEY REVIEW — … ]` placeholder instead of real wording, and
this audit trail faithfully records exactly that placeholder as what was
shown — which is correct behavior, not a bug: the proof mechanism built here
proves what was actually in front of the person, whatever that currently is.

Two consent types already reserved in `intake_consents`'s `consent_type`
CHECK constraint, `ai_disclosure` and `safe_contact`, are not written by any
code path today. `ai_disclosure` looks to be already covered — the "you are
talking to an automated assistant" line lives inside the general disclosure
and recording-prompt copy, not as a separate consent moment — and
`safe_contact` (the DV-safe "is it safe to contact you" question) is c66's
scope, where `intake_session_state.safe_contact_confirmed_at` is likewise
never set today. Whether that question should also become a tracked
acknowledgment is a c66 question, flagged here rather than built, since it
is outside what c72's note asks for.
