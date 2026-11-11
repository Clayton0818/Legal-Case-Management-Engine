# Bilingual (en/es) intake — how it works, and what still needs attorney review

**Card:** c36 · **Engine:** `intake` (c48, c65–c74) · **Status:** Spanish copy added in this PR is drafted but **not approved** — see "Needs attorney review" below before any firm uses it with real clients.

## Why this exists

`docs/product/spec/firm-config.example.yaml` already lets a firm say it serves Spanish-speaking clients (`languages.supported: [en, es]`) and route them to a `spanish_speaking_team`. Until this card, the chat UI defaulted every lead to English and most of the engine's client-facing messages — booking confirmations, reminders, follow-ups, the non-engagement notice, the generic case-status line — only existed in English. For a Texas launch, Spanish is a real market gap, and every word of it needs the same licensed-attorney review English wording already gets, not a convenience translation.

## The locale concept

- `intake_sessions.language` (shared schema, `"en" | "es" | null`) is the one place a lead's language lives. It is set when a session starts and can be updated later (e.g. a caller switches language mid-conversation); every part of the engine that sends the lead something reads it from there.
- **Default:** English. **Selectable:** Spanish. Anything else (unset, unrecognized) also falls back to English — one normalization rule, `normalizeIntakeLanguage()` in `src/engines/intake/gates.ts`, used everywhere a language needs resolving so the default lives in exactly one place.
- `POST /api/intake/sessions` now accepts an optional `{ "language": "es" }` body to start a session in Spanish; omitting it (or any other value) keeps the existing English default.
- `POST /api/intake/inbound` already accepted an explicit `language` field and kept it separate from "not specified" (`null`), so an inbound message that doesn't mention a language never overwrites a session's language — that three-way distinction (en / es / "the caller didn't say") is deliberately **not** the same thing as `normalizeIntakeLanguage()`'s two-way default, and this PR leaves that route's own logic as it was rather than collapsing the distinction.

## Routing to the Spanish-speaking team

The firm-config file's `spanish_speaking_team` isn't a literal named construct anywhere else in the codebase — the engine instead routes by capability: each lawyer has a `languages: string[]` tag on their `intakeLawyerProfiles` row (firm-admin settable), and `assignment/scoring.ts`'s `eligibilityCodes()` already excludes any lawyer whose tags don't include a matter's `language` (exclusion code `"language"`). A firm that wants a literal "Spanish-speaking team" tags every member of that team with `"es"`; nothing in this PR changes that mechanism, since it was already in place before this card and was out of scope to duplicate. `assignment/service.ts`'s `assignmentMatterFrom()` already reads `session?.language ?? "en"` into the matter facts that scoring runs against.

## The copy gate pattern, extended to Spanish

Every piece of client-facing wording in this engine is defined with `defineGate(...)` and rendered through `legalCopy(key, vars)`, which shows a visible `[PENDING ATTORNEY REVIEW — ...]` placeholder until a reviewer signs off (`reviewers: ["attorney"]`). Nothing is ever hard-coded as pre-approved. c36 adds a `bilingual()` helper in `src/engines/intake/gates.ts` that defines an English gate plus a Spanish twin with its own key (`<key>_es`), its own draft, and the same `reviewers: ["attorney"]` requirement — so Spanish wording is gated exactly as strictly as English wording, never implicitly trusted because it sits next to approved English text. `copyKeyFor(gate, language)` resolves which twin a given lead's session language should use.

This is engine-local (`src/engines/intake/**`) because the shared compliance layer (`src/compliance/approvals.ts`, `src/compliance/gates.ts`) has no locale parameter today — see "Open questions" below.

### What already had a Spanish twin before this PR

Prior c36 work already on `main` covers:
- The entry-flow chat UI's own copy layer (`src/lib/intakeEntryFlow/**`, owned by card c23) — language selection, practice-area labels and post-language prompts.
- This engine's channel disclosures, SMS/call/email auto-replies (`CHANNEL_COPY`), emergency messages (`EMERGENCY_COPY`), and the speed-to-lead AI acknowledgement (`SPEED_TO_LEAD_COPY`).
- Per-lawyer language-based assignment routing (`assignment/scoring.ts`, see above).

This PR does not touch any of that — it was already bilingual and already attorney-review-gated.

### What this PR adds

The remaining client-facing copy that was still English-only, now with an attorney-gated Spanish twin via the same `bilingual()` pattern, resolved via `copyKeyFor(gate, session.language)` at every send site:

- **Booking (`booking/service.ts`, `BOOKING_COPY`):** consultation confirmation, reminder, changed/cancelled notice, re-book offer after a no-show, and the "we'll follow up" message shown when booking can't be offered yet.
- **Matter opening (`opening/service.ts`, `OPEN_MATTER_GATES`):** the client-portal invitation and the first client update sent when a matter opens.
- **Follow-up sequences (`followUp/service.ts`, `FOLLOW_UP_GATES` / `FOLLOW_UP_TEMPLATES`):** every sequence template (abandoned chat, not booked, not signed) and the single STOP confirmation. Turning follow-ups on now requires **both** language twins of every template to be approved — a sequence can reach a lead in either language once enabled, so nothing goes out in a language nobody reviewed yet.
- **Case acceptance (`acceptance/service.ts`, `ACCEPTANCE_GATES.declineNotice`):** the neutral non-engagement notice sent on a decline (automatic, lawyer-decided borderline, or lawyer-approved post-consultation decline in `booking/service.ts`'s `recordConsultOutcome`).
- **Generic client-facing case status (`pipeline/stages.ts`, `pipeline/service.ts`, `CLIENT_STATUS_GATES`):** the one-line status a client sees per pipeline stage (e.g. "Your consultation is scheduled") now has a reviewed Spanish line for every system stage, resolved from the lead's own session's language.

Each of the above is a pure `copyKeyFor(gate, language)` lookup plus, where a function didn't already have the lead's session loaded, one extra `getSessionBundle` / `latestSessionForMatter` call — no behavior changes beyond which gate key is read.

## Needs attorney review

**Every new Spanish string this PR adds is a draft for review, not approved wording, and not legal advice.** Before any firm can use these with a real client:
- A licensed Texas attorney must review and approve each new `copy.intake.*_es` gate the same way the existing English gates are reviewed (`npm run compliance -- approve <key>`), independently of its English twin — approving one twin never approves the other.
- The translations were drafted for meaning and tone, not reviewed for Rule 1.05/1.04 compliance nuance in Spanish, regional phrasing, or whether any Spanish term reads differently than intended (e.g. idiomatic risk in the emergency/safety or non-engagement wording). That review is squarely attorney work, not something this PR can stand in for.
- `rules.intake.follow_up_outreach`, `rules.intake.auto_decline`, and the other rule-only gates this copy sits beside are unchanged by c36 and still need their own (pre-existing, English-language) review.

## Open questions for human/attorney review

1. **Shared-compliance locale support.** `defineGate`/`legalCopy` in `src/compliance/approvals.ts` have no locale parameter today. This PR works around that with an intake-local, locale-keyed pair of gates per copy item (`bilingual()` in `src/engines/intake/gates.ts`) rather than touching shared compliance files, per the engine's import boundary. If more engines need a second language, a shared `defineGate({ locales: {...} })` concept might be worth it — flagged here rather than built, since it's a cross-engine decision.
2. **`spanish_speaking_team` as a literal routing target.** The firm-config file names a team; the engine achieves the same effect through per-lawyer `languages` tags (already in place before this card) rather than a named team construct. If the product wants a literal team concept (e.g. for staffing reports), that's new scope beyond what firm-config already models.
3. **No database migration.** `intake_sessions.language` already existed on the shared schema before this card; this PR adds no column and needs no migration.
