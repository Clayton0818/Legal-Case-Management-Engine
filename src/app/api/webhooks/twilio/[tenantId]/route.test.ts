// The Twilio inbound-SMS webhook must refuse anything without the
// configured Basic credentials, refuse a malformed tenantId in the path,
// hand every well-formed inbound text to handleInboundSms() in that one
// tenant's scope, and always answer empty TwiML on an understood outcome
// (never retry-worthy). Database calls are faked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recorded: Array<{ tenantScope: string; input: Record<string, unknown> }> = [];
let scope = "";
let shouldThrow = false;

vi.mock("@/tenancy/withTenant", () => ({
  withTenant: async (tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
    scope = tenantId;
    return fn({});
  },
}));
vi.mock("@/engines/all-engines/smsChannel/service", () => ({
  handleInboundSms: async (_tx: unknown, input: Record<string, unknown>) => {
    if (shouldThrow) throw new Error("db unavailable");
    recorded.push({ tenantScope: scope, input });
    return { kind: "logged", partyId: "party-1", matterId: null, flagId: "flag-1" };
  },
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const AUTH = `Basic ${Buffer.from("sms:s3cret").toString("base64")}`;

function request(fields: Record<string, string>, auth: string | null = AUTH, tenant = TENANT): { req: Request; tenant: string } {
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  if (auth) headers.set("Authorization", auth);
  const form = new URLSearchParams(fields);
  return {
    req: new Request(`http://localhost/api/webhooks/twilio/${tenant}`, {
      method: "POST",
      headers,
      body: form.toString(),
    }),
    tenant,
  };
}

async function post(req: Request, tenant: string) {
  const { POST } = await import("./route");
  return POST(req, { params: Promise.resolve({ tenantId: tenant }) });
}

describe("POST /api/webhooks/twilio/[tenantId]", () => {
  const original = { user: process.env.SMS_WEBHOOK_USER, password: process.env.SMS_WEBHOOK_PASSWORD };

  beforeEach(() => {
    recorded.length = 0;
    shouldThrow = false;
    process.env.SMS_WEBHOOK_USER = "sms";
    process.env.SMS_WEBHOOK_PASSWORD = "s3cret";
  });
  afterEach(() => {
    if (original.user === undefined) delete process.env.SMS_WEBHOOK_USER;
    else process.env.SMS_WEBHOOK_USER = original.user;
    if (original.password === undefined) delete process.env.SMS_WEBHOOK_PASSWORD;
    else process.env.SMS_WEBHOOK_PASSWORD = original.password;
  });

  it("refuses when credentials are not configured (fails closed)", async () => {
    delete process.env.SMS_WEBHOOK_PASSWORD;
    const { req, tenant } = request({ From: "+15125550199", To: "+15125550100", Body: "hi" });
    const res = await post(req, tenant);
    expect(res.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it("refuses missing or wrong credentials", async () => {
    const { req: noAuth, tenant } = request({ From: "+15125550199", To: "+15125550100", Body: "hi" }, null);
    expect((await post(noAuth, tenant)).status).toBe(401);
    const { req: wrongAuth } = request({ From: "+15125550199", To: "+15125550100", Body: "hi" }, `Basic ${Buffer.from("sms:nope").toString("base64")}`);
    expect((await post(wrongAuth, tenant)).status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it("rejects a malformed tenantId in the path without touching the database", async () => {
    const { req } = request({ From: "+15125550199", To: "+15125550100", Body: "hi" });
    const res = await post(req, "not-a-uuid");
    expect(res.status).toBe(404);
    expect(recorded).toEqual([]);
  });

  it("hands a well-formed inbound text to handleInboundSms in the path's tenant scope", async () => {
    const { req, tenant } = request({ From: "+15125550199", To: "+15125550100", Body: "What's the status of my case?", MessageSid: "SM1" });
    const res = await post(req, tenant);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<Response></Response>");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.tenantScope).toBe(TENANT);
    expect(recorded[0]!.input).toMatchObject({
      tenantId: TENANT,
      from: "+15125550199",
      to: "+15125550100",
      body: "What's the status of my case?",
      providerMessageId: "SM1",
    });
  });

  it("answers empty TwiML (200) for a body missing From/To, without touching the database", async () => {
    const { req, tenant } = request({ Body: "hi" });
    const res = await post(req, tenant);
    expect(res.status).toBe(200);
    expect(recorded).toEqual([]);
  });

  it("answers 500 (so Twilio retries) when handling genuinely fails", async () => {
    shouldThrow = true;
    const { req, tenant } = request({ From: "+15125550199", To: "+15125550100", Body: "hi" });
    const res = await post(req, tenant);
    expect(res.status).toBe(500);
  });
});
