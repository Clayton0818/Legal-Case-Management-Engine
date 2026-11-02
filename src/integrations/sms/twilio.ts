// Twilio adapter for the notification outbox's SMS channel (c113; same
// outbox c51 built for email). Implements the SmsProvider interface from
// src/core/notify.ts; installed by ./install.ts when SMS_PROVIDER=twilio.
//
// Installing this adapter does NOT by itself send anything: every SMS row
// still has to pass the 'vendor.sms' approval gate (signed DPA + attorney
// review of TCPA consent — src/compliance/gates.ts) before this provider is
// ever called by processOutboxRow(). Consent itself (parties.safeContact) is
// enforced earlier still, by resolveClientAddress() (src/core/contacts.ts).
//
// Privacy: only the message text and the two phone numbers are sent to
// Twilio; nothing here logs either.

import type { OutboundSms, SendResult, SmsProvider } from "@/core/notify";

export const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** The firm's assigned Twilio number (E.164), or a Messaging Service SID. One of fromNumber/messagingServiceSid is required. */
  fromNumber?: string;
  messagingServiceSid?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface TwilioErrorBody {
  code?: number;
  message?: string;
  status?: number;
}

/** Twilio error codes that will not succeed on retry (bad number, opted out on Twilio's own side, etc). */
const PERMANENT_ERROR_CODES = new Set([21211, 21614, 21610, 21408]);

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";
  readonly isStub = false;

  constructor(private readonly config: TwilioConfig) {
    if (!config.accountSid.trim() || !config.authToken.trim()) {
      throw new Error("TwilioSmsProvider: accountSid and authToken are required.");
    }
    if (!config.fromNumber?.trim() && !config.messagingServiceSid?.trim()) {
      throw new Error("TwilioSmsProvider: one of fromNumber or messagingServiceSid is required.");
    }
  }

  async sendSms(message: OutboundSms): Promise<SendResult> {
    const form = new URLSearchParams();
    form.set("To", message.to);
    form.set("Body", message.text);
    if (this.config.messagingServiceSid?.trim()) {
      form.set("MessagingServiceSid", this.config.messagingServiceSid.trim());
    } else {
      form.set("From", this.config.fromNumber!.trim());
    }

    const doFetch = this.config.fetchImpl ?? fetch;
    const url = `${TWILIO_API_BASE}/Accounts/${this.config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString("base64");

    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
    } catch (err) {
      const kind = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "network error";
      return { outcome: "failed", detail: `Twilio request ${kind}; will retry.` };
    }

    let parsed: (TwilioErrorBody & { sid?: string }) | null = null;
    try {
      parsed = (await res.json()) as TwilioErrorBody & { sid?: string };
    } catch {
      // Non-JSON body (e.g. a proxy error page): fall through on the status code.
    }

    if (res.ok && parsed?.sid) {
      return { outcome: "sent", providerMessageId: parsed.sid };
    }
    if (res.status === 429 || res.status >= 500) {
      return { outcome: "failed", detail: `Twilio temporarily unavailable (HTTP ${res.status}); will retry.` };
    }
    if (res.status === 401 || res.status === 403) {
      return { outcome: "failed", detail: `Twilio rejected the account credentials (HTTP ${res.status}).` };
    }
    const code = parsed?.code;
    if (code !== undefined && PERMANENT_ERROR_CODES.has(code)) {
      return { outcome: "failed", detail: `Twilio refused the message permanently (error ${code}).` };
    }
    // Twilio's own `message` field can echo the recipient number, so it is not copied.
    return { outcome: "failed", detail: `Twilio refused the message (HTTP ${res.status}${code !== undefined ? `, error ${code}` : ""}).` };
  }
}
