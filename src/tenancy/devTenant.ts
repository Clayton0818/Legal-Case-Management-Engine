// TEMPORARY. Real auth (Clerk/WorkOS, ADR-0001 §D8) resolves "which firm is
// this request for" from a session; that doesn't exist yet (src/middleware.ts
// is an explicit stub). Until it does, API routes under /api/admin/* and
// /api/intake/* resolve the tenant from this single env var instead — one
// firm, hardcoded, loudly temporary rather than a silent fake-auth path.
//
// DO NOT let this quietly become the real tenant-resolution mechanism.
// When c9's RBAC/auth work lands, every call site importing this should be
// replaced with the real session-derived tenant id, and this file deleted.
//
// Demo deployments may set DEV_TENANT_ID=current-demo instead of a firm id
// (src/tenancy/demoFollow.ts). This function is synchronous, so it cannot
// look the demo firm up itself: it returns the firm found by the last
// lookup, which every staff page load and every /demo load makes (and a
// reset refreshes at once).

import { getCachedDemoTarget, isFollowDemo } from "./demoFollow";

export function getDevTenantId(): string {
  const id = process.env.DEV_TENANT_ID;
  if (!id) {
    throw new Error(
      "DEV_TENANT_ID is not set. This is a temporary stand-in for real " +
        "auth (see this file's own comment) — set it to a real firms.id " +
        "for local/staging use until c9's auth work replaces this entirely."
    );
  }
  if (isFollowDemo(id)) {
    const target = getCachedDemoTarget();
    if (!target) {
      throw new Error(
        "DEV_TENANT_ID=current-demo follows the newest demo firm, but this server has not looked it up yet " +
          "(it does so whenever /demo or a staff page loads). Open /demo once, then try again."
      );
    }
    return target.tenantId;
  }
  return id;
}
