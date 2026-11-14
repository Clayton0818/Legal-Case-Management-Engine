import { afterEach, describe, expect, it, vi } from "vitest";

const principal = vi.hoisted(() => ({ value: { userId: "11111111-1111-4111-8111-111111111111" as string | null }, calls: 0 }));
vi.mock("./request", () => ({
  requirePrincipal: async () => {
    principal.calls += 1;
    return principal.value;
  },
}));

import { authRequestFrom, decideStaffSource, resolveStaffUserId } from "./staff";
import type { TenantTx } from "@/tenancy/withTenant";

const USER = "7d3c5a0e-3f4b-4b8a-9d61-2f0b1c9e8a11";
const TENANT = "22222222-2222-4222-8222-222222222222";
const tx = {} as TenantTx;
const base = { production: false, allowHeaderInProduction: false, headerValue: null, hasCredential: false, required: true };

afterEach(() => {
  principal.value = { userId: "11111111-1111-4111-8111-111111111111" };
  principal.calls = 0;
});

describe("decideStaffSource", () => {
  it("vendor sign-in: uses the session and IGNORES the old header", () => {
    expect(decideStaffSource({ ...base, mode: "clerk", headerValue: USER, hasCredential: true })).toEqual({ kind: "session" });
    expect(decideStaffSource({ ...base, mode: "clerk", headerValue: USER })).toMatchObject({ kind: "error", status: 401 });
    expect(decideStaffSource({ ...base, mode: "clerk", headerValue: USER, required: false })).toEqual({ kind: "anonymous" });
  });

  it("no sign-in configured: nobody is staff", () => {
    expect(decideStaffSource({ ...base, mode: "none", headerValue: USER })).toMatchObject({ kind: "error", status: 401 });
    expect(decideStaffSource({ ...base, mode: "none", headerValue: USER, required: false })).toEqual({ kind: "anonymous" });
  });

  it("dev mode: the header names the staff member; a bad id is a 400", () => {
    expect(decideStaffSource({ ...base, mode: "dev", headerValue: USER })).toEqual({ kind: "header", userId: USER });
    expect(decideStaffSource({ ...base, mode: "dev", headerValue: "admin" })).toMatchObject({ kind: "error", status: 400 });
  });

  it("dev mode without a header: required -> the dev session's user; optional -> a client", () => {
    expect(decideStaffSource({ ...base, mode: "dev" })).toEqual({ kind: "session" });
    expect(decideStaffSource({ ...base, mode: "dev", required: false })).toEqual({ kind: "anonymous" });
  });

  it("dev mode in production: the header only counts when an operator opts in", () => {
    expect(decideStaffSource({ ...base, mode: "dev", production: true, headerValue: USER })).toEqual({ kind: "session" });
    expect(decideStaffSource({ ...base, mode: "dev", production: true, headerValue: USER, required: false })).toEqual({ kind: "anonymous" });
    expect(decideStaffSource({ ...base, mode: "dev", production: true, allowHeaderInProduction: true, headerValue: USER })).toEqual({
      kind: "header",
      userId: USER,
    });
  });
});

describe("authRequestFrom", () => {
  it("reads headers and individual cookies", () => {
    const r = authRequestFrom(new Request("http://x", { headers: { authorization: "Bearer t", cookie: "a=1; __session=abc%3D; b=2" } }));
    expect(r.header("authorization")).toBe("Bearer t");
    expect(r.cookie("__session")).toBe("abc=");
    expect(r.cookie("missing")).toBeNull();
  });
});

describe("resolveStaffUserId", () => {
  const req = (h: Record<string, string> = {}) => new Request("http://x", { headers: h });

  it("vendor mode: a header alone is not a sign-in", async () => {
    const env = { AUTH_PROVIDER: "clerk" };
    await expect(resolveStaffUserId(tx, TENANT, req({ "x-user-id": USER }), { header: "x-user-id", env })).rejects.toMatchObject({ status: 401 });
    expect(await resolveStaffUserId(tx, TENANT, req({ "x-user-id": USER }), { header: "x-user-id", env, required: false })).toBeNull();
    expect(principal.calls).toBe(0);
  });

  it("vendor mode: the signed-in session's user", async () => {
    const env = { AUTH_PROVIDER: "clerk" };
    expect(await resolveStaffUserId(tx, TENANT, req({ cookie: "__session=jwt" }), { header: "x-user-id", env })).toBe("11111111-1111-4111-8111-111111111111");
    expect(principal.calls).toBe(1);
  });

  it("dev mode: header first, then the dev session's real user", async () => {
    const env = { DEV_TENANT_ID: TENANT, NODE_ENV: "test" };
    expect(await resolveStaffUserId(tx, TENANT, req({ "x-intake-user-id": USER }), { header: "x-intake-user-id", env })).toBe(USER);
    expect(await resolveStaffUserId(tx, TENANT, req(), { header: "x-intake-user-id", env })).toBe("11111111-1111-4111-8111-111111111111");
    expect(await resolveStaffUserId(tx, TENANT, req(), { header: "x-intake-user-id", env, required: false })).toBeNull();
  });

  it("dev mode: the synthetic dev admin is not a person, so staff actions are refused", async () => {
    principal.value = { userId: null };
    const env = { DEV_TENANT_ID: TENANT, NODE_ENV: "test" };
    await expect(resolveStaffUserId(tx, TENANT, req(), { header: "x-intake-user-id", env })).rejects.toMatchObject({ status: 401 });
  });
});
