import { afterEach, describe, expect, it } from "vitest";
import { resolveAuthConfig } from "@/auth/config";
import { getDevTenantId } from "@/tenancy/devTenant";
import { CURRENT_DEMO_TENANT, getCachedDemoTarget, isFollowDemo, setCachedDemoTarget } from "@/tenancy/demoFollow";
import { DEMO_FOLLOW_TTL_MS, DemoFollowError, parseDemoUserKey, resolveDemoTarget, type DemoFollowDeps } from "./follow";
import { staffByKey } from "./fixtures";

const DEMO = "11111111-1111-4111-8111-111111111111";
const NEWER = "33333333-3333-4333-8333-333333333333";
const PARTNER_ID = "22222222-2222-4222-8222-222222222222";
const ON = { DEMO_RESET_ENABLED: "1", DEV_TENANT_ID: CURRENT_DEMO_TENANT };

/** Fake database steps that record what they were asked. */
function fakeDeps(firm: string | null, usersByEmail: Record<string, string> = {}) {
  const calls = { find: 0, confirm: [] as Array<{ tenantId: string; email: string | null }> };
  const deps: DemoFollowDeps = {
    async findCurrentDemoFirm() {
      calls.find += 1;
      return firm ? { tenantId: firm } : null;
    },
    async confirmFirmAndFindUser(tenantId, email) {
      calls.confirm.push({ tenantId, email });
      return email ? (usersByEmail[email] ?? null) : null;
    },
  };
  return { deps, calls };
}

const ORIGINAL_DEV_TENANT_ID = process.env.DEV_TENANT_ID;

afterEach(() => {
  setCachedDemoTarget(null);
  if (ORIGINAL_DEV_TENANT_ID === undefined) delete process.env.DEV_TENANT_ID;
  else process.env.DEV_TENANT_ID = ORIGINAL_DEV_TENANT_ID;
});

describe("the current-demo switch", () => {
  it("is recognised in any case, and nothing else is", () => {
    expect(isFollowDemo("current-demo")).toBe(true);
    expect(isFollowDemo(" Current-Demo ")).toBe(true);
    expect(isFollowDemo(DEMO)).toBe(false);
    expect(isFollowDemo("")).toBe(false);
    expect(isFollowDemo(undefined)).toBe(false);
  });

  it("still counts as dev mode for the edge middleware", () => {
    expect(resolveAuthConfig({ DEV_TENANT_ID: CURRENT_DEMO_TENANT }).mode).toBe("dev");
  });
});

describe("DEV_DEMO_USER", () => {
  it("accepts a demo staff key, treats empty as the dev administrator, and refuses anything else", () => {
    expect(parseDemoUserKey("partner")).toBe("partner");
    expect(parseDemoUserKey(" admin ")).toBe("admin");
    expect(parseDemoUserKey(undefined)).toBeNull();
    expect(parseDemoUserKey("  ")).toBeNull();
    expect(() => parseDemoUserKey(PARTNER_ID)).toThrow(DemoFollowError);
    expect(() => parseDemoUserKey("root")).toThrow(/not one of the demo firm's staff/);
  });
});

describe("resolveDemoTarget", () => {
  it("is refused unless this is a demo deployment", async () => {
    const { deps, calls } = fakeDeps(DEMO);
    await expect(resolveDemoTarget(deps, { env: { DEV_TENANT_ID: CURRENT_DEMO_TENANT } })).rejects.toMatchObject({ code: "demo_off" });
    expect(calls.find).toBe(0); // refused before touching the database
  });

  it("points the session at the current demo firm as the dev administrator by default", async () => {
    const { deps, calls } = fakeDeps(DEMO);
    const target = await resolveDemoTarget(deps, { env: ON, now: 1_000 });
    expect(target).toMatchObject({ tenantId: DEMO, userId: null, userKey: null });
    expect(calls.confirm).toEqual([{ tenantId: DEMO, email: null }]); // the flag is re-checked in that firm
  });

  it("signs in as the named fictional staff member, looked up by their example.com email inside the demo firm", async () => {
    const email = staffByKey("partner").email;
    const { deps, calls } = fakeDeps(DEMO, { [email]: PARTNER_ID });
    const target = await resolveDemoTarget(deps, { env: { ...ON, DEV_DEMO_USER: "partner" } });
    expect(target).toMatchObject({ tenantId: DEMO, userId: PARTNER_ID, userKey: "partner" });
    expect(calls.confirm).toEqual([{ tenantId: DEMO, email }]);
  });

  it("explains what to do when there is no demo firm yet, and when the staff member is missing", async () => {
    await expect(resolveDemoTarget(fakeDeps(null).deps, { env: ON })).rejects.toMatchObject({ code: "no_demo_firm" });
    await expect(resolveDemoTarget(fakeDeps(DEMO).deps, { env: { ...ON, DEV_DEMO_USER: "partner" } })).rejects.toMatchObject({
      code: "demo_user_missing",
    });
  });

  it("reuses a fresh lookup, looks again once it is stale, and a forced lookup picks up a reset at once", async () => {
    const first = fakeDeps(DEMO);
    await resolveDemoTarget(first.deps, { env: ON, now: 1_000 });

    const again = fakeDeps(NEWER);
    expect((await resolveDemoTarget(again.deps, { env: ON, now: 1_000 + DEMO_FOLLOW_TTL_MS })).tenantId).toBe(DEMO);
    expect(again.calls.find).toBe(0);

    expect((await resolveDemoTarget(again.deps, { env: ON, now: 1_000 + DEMO_FOLLOW_TTL_MS + 1 })).tenantId).toBe(NEWER);

    const reset = fakeDeps(DEMO);
    expect((await resolveDemoTarget(reset.deps, { env: ON, now: 1_000 + DEMO_FOLLOW_TTL_MS + 2, force: true })).tenantId).toBe(DEMO);
    expect(reset.calls.find).toBe(1);
  });

  it("does not reuse a lookup made for a different DEV_DEMO_USER", async () => {
    const email = staffByKey("partner").email;
    await resolveDemoTarget(fakeDeps(DEMO).deps, { env: ON, now: 1_000 });
    const asPartner = fakeDeps(DEMO, { [email]: PARTNER_ID });
    expect((await resolveDemoTarget(asPartner.deps, { env: { ...ON, DEV_DEMO_USER: "partner" }, now: 1_001 })).userId).toBe(PARTNER_ID);
    expect(asPartner.calls.find).toBe(1);
  });

  it("forgets the old firm when the demo has been switched off", async () => {
    await resolveDemoTarget(fakeDeps(DEMO).deps, { env: ON, now: 1_000 });
    await expect(resolveDemoTarget(fakeDeps(null).deps, { env: ON, now: 1_000, force: true })).rejects.toBeInstanceOf(DemoFollowError);
    expect(getCachedDemoTarget()).toBeNull();
  });
});

describe("getDevTenantId with DEV_TENANT_ID=current-demo", () => {
  it("returns the firm from the last lookup, and says what to do before there is one", async () => {
    process.env.DEV_TENANT_ID = CURRENT_DEMO_TENANT;
    expect(() => getDevTenantId()).toThrow(/Open \/demo once/);
    await resolveDemoTarget(fakeDeps(DEMO).deps, { env: ON });
    expect(getDevTenantId()).toBe(DEMO);
  });

  it("leaves a fixed DEV_TENANT_ID exactly as it was", () => {
    process.env.DEV_TENANT_ID = DEMO;
    setCachedDemoTarget({ tenantId: NEWER, userId: null, userKey: null });
    expect(getDevTenantId()).toBe(DEMO);
  });
});
