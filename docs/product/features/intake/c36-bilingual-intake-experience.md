# c36 · Bilingual (en/es) intake experience

**Card:** `c36` Bilingual (en/es) intake experience (Product, P1, backlog).
**Status:** The actual gap this card names — the client-facing chat UI (`c23`) showing only English after a caller asks for Spanish — is fixed in this PR. The approval-gate layer for the fuller omnichannel intake engine (`c65`–`c74`) was already bilingual before this PR (see §1); the firm-config language surface and a handful of remaining single-language copy gates are not, and are listed in §4 as follow-up, not done here.

## 1. What already existed

Two separate systems in this repo touch intake language, and only one of them had a real gap:

- `src/engines/intake/` (the full omnichannel engine, cards `c65`–`c74`): `gates.ts` already defines a `bilingual()` helper and uses it for `CHANNEL_COPY`, `EMERGENCY_COPY` and `SPEED_TO_LEAD_COPY`, each with an `_es` gate twin pending its own attorney sign-off. `channels/service.ts` already stores `session.language` (`"en" | "es"`), accepts a `language` param on every inbound event, lets it change mid-conversation, and already calls `copyKeyFor(gate, session.language)` at every one of those copy sites. `/api/intake/inbound` already accepts and forwards a `language` field. None of this needed changing — it was the part of the product c36's note didn't actually point at.
- `src/lib/intakeEntryFlow/` (the simpler "entry" flow behind the live `/chat` page and `IntakeChatWidget`, board card `c23`): this is what the note means by "c23's chat UI defaults everyone to English with no real Spanish copy layer." The flow already *asks* for a language preference (`language_routing` node, with an English/Español chip picker) and stores the answer (`CollectedAnswers.language`) — but `engine.ts`'s `getPrompt()` read every message from a single English-only `COPY` object and never looked at the stored answer. A caller who picked "Español" kept getting English prompts for the rest of the conversation.

## 2. What this PR changes

Only `src/lib/intakeEntryFlow/`:

- `copy.ts`: added a Spanish translation for every string reachable *after* `language_routing` (`askPracticeAreaFreeText`, `confirmGuess`, `askManualPracticeArea`, `confirmYes`, `confirmNo`, `entryComplete`) and for the practice-area labels/chip options, exposed as `postLanguageCopy(language)`, `practiceAreaLabelsFor(language)` and `practiceAreaOptionsForLanguage(language)`. `askLanguage` itself now asks in both languages at once ("Which language do you prefer? / ¿Qué idioma prefiere?"), since the caller hasn't chosen yet at that point.
- `engine.ts`: `getPrompt()`'s `classify_practice_area` and `out_of_scope_gate` cases now select copy and practice-area labels/options through those three functions using `answers.language`, instead of always reading the English-only constants.
- Added `engine.test.ts` (this module had no tests at all before): 9 tests covering the English default, a full English happy path, a full Spanish happy path, the bilingual `language_routing` prompt, the unsupported-language validation error, and — importantly — that `classify_caller`/`capture_contact`/`existing_caller_handoff`/`declined_conflict` stay English even when `answers.language` is already `"es"` in the stored answers (see §3).

Nothing in `src/engines/intake/`, the database schema, or any API route changed.

## 3. Scoping decision: why four nodes stay English-only

`intake-flow.yaml`'s entry sequence is `classify_caller -> capture_contact -> language_routing -> classify_practice_area`. The caller's language isn't known yet at `classify_caller` or `capture_contact` — they're asked *before* `language_routing`. `existing_caller_handoff` and `declined_conflict` are reached directly from `classify_caller`'s branches and never pass through `language_routing` at all. So those four nodes' copy is English-only by the flow's own structure, not a remaining instance of this card's gap; a test in `engine.test.ts` pins this down explicitly so a future change to the node order doesn't silently assume otherwise. Reordering the flow so language is asked first is a product/UX decision (it would mean asking caller type and contact details in whatever language the caller happens to type in before being asked) that this PR deliberately didn't make — it's a scope question for whoever reviews this, not an engineering default.

## 4. What is still not bilingual (follow-up, not this PR)

- `src/engines/intake/gates.ts`: `BOOKING_COPY`, `OPEN_MATTER_GATES.portalInvite`/`matterOpened`, `FOLLOW_UP_GATES.stopConfirmation`, `FOLLOW_UP_TEMPLATES.*`, `ACCEPTANCE_GATES.declineNotice`, and `CLIENT_STATUS_GATES.*` are all single-language English gates today. Converting each to the existing `bilingual()` pattern (mirroring `CHANNEL_COPY`/`EMERGENCY_COPY`/`SPEED_TO_LEAD_COPY`) is mechanical but is real new attorney-reviewable content for every item, so it's left as follow-up work rather than folded into this PR.
- `docs/product/spec/firm-config.example.yaml` already models `languages.supported: [en, es]`, `staff_by_language` and an `overflow_service` for "no language-matched staff available." Nothing in `src/engines/intake/settings.ts` (`IntakeSettings`) surfaces that yet — there's no firm-editable list of supported languages or staff-language routing in the actual settings model. That's a separate, larger gap (it touches staff assignment, not just copy) and is left for a future card.
- `src/engines/intake/identity/service.ts`'s one-time verification code is deliberately left non-bilingual per its own comment (code + firm name are the only variable content) — unchanged here, consistent with that existing decision.

## 5. Attorney review

Every Spanish string added here is a direct translation of an existing, already-flagged-unreviewed English placeholder in the same file (`copy.ts`'s header has carried a "NOT ATTORNEY-REVIEWED" notice since `c23` shipped). No new legal claim, promise or characterization was introduced — translation only. Per CLAUDE.md's compliance guardrails, this still needs the same licensed-Texas-attorney review as the English original, in both languages, before real use; the file's header now says so explicitly for both.

## 6. Verification

`npx tsc --noEmit`, `npx eslint .` and `npx vitest run` all pass locally against this branch (1338 tests passed, 15 skipped — the pre-existing DB-only tests that need `DATABASE_URL`), including the 9 new tests in `src/lib/intakeEntryFlow/engine.test.ts`.
