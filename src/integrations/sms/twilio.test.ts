import { describe, expect, it } from "vitest";
import { TWILIO_API_BASE, TwilioSmsProvider, type TwilioConfig } from "./twilio";
import { smsProviderFromEnv } from "./install";
import type { OutboundSms } from "@/core/notify";

const MESSAGE: OutboundSms = {
  notificationId: "22222222-2222-4222-8222-222222222222",
  tenantId: "11111111-1111-4111-8111-111111111111",
  to: "+15125550199",
  text: "Please sign in to your portal.",
};

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; init: RequestInit }> = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

function provider(fetchImpl: typeof fetch, extra: Partial<TwilioConfig> = {}) {
  return new TwilioSmsProvider({ accountSid: "AC123", authToken: "token-123", fromNumber: "+15125550100", fetchImpl, ...extra });
}

describe("TwilioSmsProvider", () => {
  it("requires account credentials and a From/MessagingServiceSid", () => {
    expect(() => new TwilioSmsProvider({ accountSid: "", authToken: "t", fromNumber: "+1" })).toThrow(/accountSid/);
    expect(() => new TwilioSmsProvider({ accountSid: "AC1", authToken: "" })).toThrow(/authToken|fromNumber/);
    expect(() => new TwilioSmsProvider({ accountSid: "AC1", authToken: "t" })).toThrow(/fromNumber or messagingServiceSid/);
  });

  it("sends via the Messages resource with Basic auth and form-encoded body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await provider(fakeFetch(201, { sid: "SM123" }, calls)).sendSms(MESSAGE);
    expect(result).toEqual({ outcome: "sent", providerMessageId: "SM123" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${TWILIO_API_BASE}/Accounts/AC123/Messages.json`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("AC123:token-123").toString("base64")}`);
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get("To")).toBe("+15125550199");
    expect(body.get("From")).toBe("+15125550100");
    expect(body.get("Body")).toBe("Please sign in to your portal.");
  });

  it("prefers a Messaging Service SID over From when both are configured", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    await provider(fakeFetch(201, { sid: "SM1" }, calls), { messagingServiceSid: "MG999" }).sendSms(MESSAGE);
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(body.get("MessagingServiceSid")).toBe("MG999");
    expect(body.get("From")).toBeNull();
  });

  it("treats 5xx, 429 and network errors as retryable failures", async () => {
    expect((await provider(fakeFetch(503, "down")).sendSms(MESSAGE)).detail).toMatch(/will retry/);
    expect((await provider(fakeFetch(429, {})).sendSms(MESSAGE)).detail).toMatch(/will retry/);
    const throwing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await provider(throwing).sendSms(MESSAGE);
    expect(result).toEqual({ outcome: "failed", detail: "Twilio request network error; will retry." });
  });

  it("flags a permanent error (e.g. invalid number) without echoing Twilio's own message", async () => {
    const result = await provider(fakeFetch(400, { code: 21211, message: "Invalid 'To' Phone Number: +15125550199" })).sendSms(MESSAGE);
    expect(result.outcome).toBe("failed");
    expect(result.detail).toMatch(/permanently/);
    expect(result.detail).not.toContain("+15125550199");
  });

  it("flags bad account credentials clearly", async () => {
    expect((await provider(fakeFetch(401, { code: 20003, message: "Authenticate" })).sendSms(MESSAGE)).detail).toMatch(/credentials/);
  });
});

describe("smsProviderFromEnv", () => {
  it("keeps the stub unless Twilio is asked for and fully configured", () => {
    expect(smsProviderFromEnv({}).provider).toBeNull();
    expect(smsProviderFromEnv({ SMS_PROVIDER: "plivo" }).reason).toMatch(/Unknown/);
    expect(smsProviderFromEnv({ SMS_PROVIDER: "twilio" }).reason).toMatch(/TWILIO_ACCOUNT_SID/);
    expect(
      smsProviderFromEnv({ SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }).reason
    ).toMatch(/TWILIO_FROM_NUMBER/);
  });

  it("builds a real (non-stub) Twilio provider from a from-number or a messaging service", () => {
    const { provider: p, reason } = smsProviderFromEnv({
      SMS_PROVIDER: "Twilio",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
      TWILIO_FROM_NUMBER: "+15125550100",
    });
    expect(p?.name).toBe("twilio");
    expect(p?.isStub).toBe(false);
    expect(reason).toBeNull();

    const { provider: p2 } = smsProviderFromEnv({
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
      TWILIO_MESSAGING_SERVICE_SID: "MG1",
    });
    expect(p2?.name).toBe("twilio");
  });
});
