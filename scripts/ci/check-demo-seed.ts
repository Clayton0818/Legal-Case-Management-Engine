// CI check: seed a fresh demo firm end to end and fail if any seed step fails.
//
// The demo seed (src/engines/demo/seed.ts) drives every engine through its
// real services: intake chat, conflict check, opening a matter, documents,
// calendar, client alerts, billing and trust. Running it against a database
// built only from migrations/ is the closest thing to a whole-pipeline smoke
// test without a browser. Steps that are "blocked" (waiting on an attorney/
// CPA/vendor approval gate) are expected and allowed; "failed" ones are bugs
// or missing migrations and fail the job.
//
// Usage: DATABASE_URL=<app_runtime url> DEMO_RESET_ENABLED=1 npx tsx scripts/ci/check-demo-seed.ts

import { withTenant } from "@/tenancy/withTenant";
import { ensureServerApprovals } from "@/compliance/server";
import { createDemoTenant, type TenantRunner } from "@/engines/demo/reset";

const run: TenantRunner = (tenantId, fn) => withTenant(tenantId, fn);

async function main(): Promise<void> {
  if (process.env.DEMO_RESET_ENABLED !== "1") throw new Error("Set DEMO_RESET_ENABLED=1 (test database only).");
  await ensureServerApprovals();
  const created = await createDemoTenant(run, { createdBy: "CI pipeline check" });
  const { ok, blocked, failed } = created.summary;
  console.log(`[demo-seed] firm ${created.tenantId}: ${ok} ok, ${blocked} blocked (waiting on an approval), ${failed} failed`);
  for (const step of created.report.steps.filter((s) => s.status === "blocked")) {
    console.log(`  blocked  ${step.area} / ${step.key}  (${step.gate ?? "gate"})`);
  }
  const failures = created.report.steps.filter((s) => s.status === "failed");
  if (failures.length > 0) {
    console.error(`[demo-seed] FAIL: ${failures.length} step(s) failed:`);
    for (const step of failures) console.error(`  FAILED   ${step.area} / ${step.key}: ${step.detail ?? ""}`);
    process.exit(1);
  }
  console.log("[demo-seed] OK");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[demo-seed] error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
