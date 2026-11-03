# c113 — Two-way SMS/text channel for client communication

**Code:** `src/integrations/sms/{twilio,install}.ts`, `src/app/api/webhooks/twilio/[tenantId]/route.ts`, `src/engines/all-engines/smsChannel/{consent,types,service}.ts`.
**Not legal advice; not a finished feature.** This PR builds the vendor integration and the inbound half of the channel, and deliberately stops short of a full two-way conversation UI — see "What this PR does NOT build" below.

## Why this card existed

The competitive scan (c15 follow-up, 2026-10-15) found every mainstream competitor (Clio, MyCase, PracticePanther) treats two-way text as a core channel. Today every **client-facing, post-retention** channel is email + the portal (c51, c54, c64); the intake engine already has its own one-way-in SMS handling during triage (c65/c70, `src/engines/intake/channels`, `followUp/sequence.ts`'s STOP detection), but that is pre-retention UPL-flow territory and belongs to the intake engine, not here.

Outbound SMS was already half-built: `src/core/notify.ts` (c51) already defines channel `"sms"`, an `SmsProvider` interface, a `StubProvider`, and the `vendor.sms` gate (`src/compliance/gates.ts`) already exists with TCPA-attorney review required. **What was missing: a real vendor adapter (so an approved gate can actually send something) and any way at all to receive a client's reply.** This PR builds both of those, reusing the existing gate and outbox rather than adding a parallel one.

## What this PR builds

1. **`src/integrations/sms/twilio.ts`** — `TwilioSmsProvider implements SmsProvider`, mirroring `src/integrations/email/postmark.ts` exactly (same error-classification shape: permanent vendor error vs. retryable 5xx/429/network, never echoes Twilio's own message text since it can contain the phone number).
2. **`src/integrations/sms/install.ts`** — `installSmsProviderFromEnv()`, mirroring `src/integrations/email/install.ts`: `SMS_PROVIDER=twilio` + `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / (`TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`) installs the real adapter; anything else keeps the stub. **Not wired into `src/worker/tick.ts`** — that file is shared (`src/worker/**`) and engine PRs don't edit it. See "Foundation request" below.
3. **`src/app/api/webhooks/twilio/[tenantId]/route.ts`** — inbound webhook, Basic-auth protected (`SMS_WEBHOOK_USER`/`SMS_WEBHOOK_PASSWORD`, same scheme as the Postmark webhook). Each firm gets its own Twilio number and therefore its own webhook URL (`.../twilio/<tenantId>`) — unlike Postmark's delivery webhook there is no shared metadata on an inbound text to recover the tenant from, so the tenant has to come from which URL Twilio was configured to call.
4. **`src/engines/all-engines/smsChannel/`** — the domain logic the webhook calls, in order:
   - **TCPA keyword** (`consent.ts`, pure, tested): STOP/START/HELP family, whole-message match only (so "stop by the office tomorrow" is never read as an opt-out).
   - **Party match by phone** (`service.ts`): against `parties.phone`, `parties.phones[]` and `safeContact.safePhone`, normalized (strips formatting and a leading country code).
   - **STOP/START**: updates `parties.safeContact.smsAllowed` / `smsConsentAt` directly — the SAME field `src/core/contacts.ts`'s `resolveClientAddress()` already reads for outbound, and the SAME field the intake engine already writes for its own STOP handling (`followUp/service.ts`). One consent record per party, not a channel-specific copy.
   - **HELP / an ordinary message**: raises an **internal** flag (`sms.help_requested` / `sms.inbound_received`) to the matter's assigned lawyer (if the party has one active matter) plus firm admins, surfaced through the existing ops "attention needed" queue (c37) — nothing is auto-replied with case content (`src/engines/README.md`'s "founder decisions": the AI never gives legal advice or decides anything on a client's behalf without a human in the loop).
   - **No matching party**: raises an internal flag to firm admins so staff can triage an unrecognised number by hand; no party or matter is auto-created.

## What this PR does NOT build (open questions, not oversights)

- **A two-way conversation thread / admin UI.** Today a human sees "new text from Chris Client" in the attention queue and has to reply by phone, the Twilio console, or email — not from inside this product. A real thread view needs a **shared** message-log table (not owned by any one engine, the same way `notification_outbox` and `flags` are shared) so every engine's client communication — this SMS channel, calendar-alerts' own reply-clock messages (`src/engines/calendar-alerts/replyClock/service.ts`, which already accepts a generic `channel` including, presumably, `"sms"`), and a future staff-composed free-text reply — can read and write one place instead of three disconnected logs. **Foundation request:** a `client_messages`-shaped table in `src/db/tables/foundation.ts`, or a decision that calendar-alerts' reply-clock table is that shared place and every channel writes to it through a shared `src/core` function. This is squarely the kind of thing `src/engines/README.md` says to flag instead of patch around in an engine PR.
- **Staff free-text replies.** Sending an approved `legalCopy()` template through `enqueueNotification({channel: "sms", ...})` already works (it's generic, from c51). A lawyer typing their own words back to a client is a different, smaller gap (same as calendar-alerts' `recordOutboundMessage` already does for email) — reasonable to add once the shared thread question above is settled, so it isn't built twice.
- **Per-firm number provisioning UI.** Today a firm's Twilio number and webhook URL are set up by hand in the Twilio console and this file. A firm-settings page to manage this (parallel to `email-delivery-setup.md`'s runbook) is straightforward once there's more than one pilot firm actually texting.
- **`src/worker/tick.ts` wiring** for `installSmsProviderFromEnv()` — one line, alongside the existing `installEmailProviderFromEnv()` call (around line 97), left for Clayton or a follow-up PR since that file is shared.

## Setup

Same shape as `docs/architecture/email-delivery-setup.md`, with SMS's extra step (an inbound webhook needs a stable public URL before Twilio can be configured at all):

1. Twilio account → buy a number (or set up a Messaging Service) → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
2. Set `SMS_PROVIDER=twilio`, the credentials above, and `TWILIO_FROM_NUMBER` (or `TWILIO_MESSAGING_SERVICE_SID`) wherever the worker tick runs (same place as the Postmark env vars) — once `src/worker/tick.ts` calls `installSmsProviderFromEnv()` (see above).
3. Set `SMS_WEBHOOK_USER` / `SMS_WEBHOOK_PASSWORD` on the web service (same place as the Postmark webhook credentials).
4. In the Twilio console, on that number: Messaging → "A MESSAGE COMES IN" → webhook `https://<user>:<password>@<host>/api/webhooks/twilio/<tenantId>`, HTTP POST.
5. Sign Twilio's DPA, then: `npm run compliance -- approve --gate vendor.sms --reviewer vendor_dpa --by "..."` and, separately, the attorney's TCPA-consent-rules review the same gate also requires (`reviewers: ["vendor_dpa", "attorney"]`).

## Tests

`src/engines/all-engines/smsChannel/consent.test.ts` (pure keyword/phone matching), `src/integrations/sms/twilio.test.ts` (adapter + env wiring, fetch faked), `src/app/api/webhooks/twilio/[tenantId]/route.test.ts` (auth, tenant-path validation, dispatch, always-TwiML-200-or-retry-500), `src/engines/all-engines/smsChannel/service.db.test.ts` (phone match, STOP/START consent round-trip, dedupe by `MessageSid`; needs a real Postgres, skipped otherwise).
