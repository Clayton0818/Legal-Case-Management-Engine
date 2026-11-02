// Chooses the SMS adapter for this process from environment variables and
// installs it into the notification outbox (src/core/notify.ts). Mirrors
// src/integrations/email/install.ts exactly.
//
//   SMS_PROVIDER=twilio               turn on the Twilio adapter
//   TWILIO_ACCOUNT_SID=…               Twilio Account SID
//   TWILIO_AUTH_TOKEN=…                Twilio Auth Token (secret)
//   TWILIO_FROM_NUMBER=…                the firm's Twilio number (E.164) — or:
//   TWILIO_MESSAGING_SERVICE_SID=…      a Messaging Service SID (one of the two is required)
//
// Anything else (unset, or missing credentials) keeps the StubProvider, which
// records and holds. Either way the 'vendor.sms' gate still decides whether a
// row may be sent at all.
//
// NOT wired into src/worker/tick.ts by this PR — that file is shared
// (src/worker/**) and engine PRs don't edit it (src/engines/README.md). It
// needs the same one line installEmailProviderFromEnv() already has:
//   const sms = installSmsProviderFromEnv();
// alongside `const email = installEmailProviderFromEnv();` (src/worker/tick.ts
// around line 97) — flagged for Clayton/a follow-up PR rather than patched
// here.

import { setNotificationProviders } from "@/core/notify";
import { TwilioSmsProvider } from "./twilio";

type Env = Record<string, string | undefined>;

export interface SmsInstallResult {
  provider: "twilio" | "stub";
  /** Why the stub was kept, when it was. Never contains secrets. */
  reason: string | null;
}

/** Pure: which adapter the environment asks for (null = keep the stub). */
export function smsProviderFromEnv(env: Env = process.env): { provider: TwilioSmsProvider | null; reason: string | null } {
  const choice = (env.SMS_PROVIDER ?? "").trim().toLowerCase();
  if (!choice || choice === "stub") return { provider: null, reason: "SMS_PROVIDER is not set." };
  if (choice !== "twilio") return { provider: null, reason: `Unknown SMS_PROVIDER '${choice}'.` };

  const accountSid = (env.TWILIO_ACCOUNT_SID ?? "").trim();
  const authToken = (env.TWILIO_AUTH_TOKEN ?? "").trim();
  if (!accountSid || !authToken) return { provider: null, reason: "SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not both set." };

  const fromNumber = (env.TWILIO_FROM_NUMBER ?? "").trim();
  const messagingServiceSid = (env.TWILIO_MESSAGING_SERVICE_SID ?? "").trim();
  if (!fromNumber && !messagingServiceSid) {
    return { provider: null, reason: "SMS_PROVIDER=twilio but neither TWILIO_FROM_NUMBER nor TWILIO_MESSAGING_SERVICE_SID is set." };
  }

  return {
    provider: new TwilioSmsProvider({
      accountSid,
      authToken,
      ...(fromNumber ? { fromNumber } : {}),
      ...(messagingServiceSid ? { messagingServiceSid } : {}),
    }),
    reason: null,
  };
}

/** Install the adapter the environment asks for. Returns what happened, for the tick log. */
export function installSmsProviderFromEnv(env: Env = process.env): SmsInstallResult {
  const { provider, reason } = smsProviderFromEnv(env);
  if (!provider) return { provider: "stub", reason };
  setNotificationProviders({ sms: provider });
  return { provider: "twilio", reason };
}
