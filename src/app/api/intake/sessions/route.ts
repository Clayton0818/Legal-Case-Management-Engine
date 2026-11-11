import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDevTenantId } from "@/tenancy/devTenant";
import { firmConfigVersions, intakeEvents, intakeSessions } from "@/db/schema";
import { getPrompt } from "@/lib/intakeEntryFlow/engine";
import type { LeadAttributionInput } from "@/engines/intake/attribution/model";

// withTenant (and, transitively, src/tenancy/db.ts) is imported lazily
// inside the handler, not statically at module scope. db.ts throws at
// import time if DATABASE_URL is unset, and `next build`'s "collecting
// page data" step actually loads every route module to inspect it — a
// static top-level import here would make DATABASE_URL a *build-time*
// requirement (CI's build step deliberately runs without it; see
// .github/workflows/ci.yml). A dynamic import defers that module
// evaluation to request time, which is the only time it should matter.

// Thrown when this tenant has no firm_config_versions row to reference.
// intake_sessions.firm_config_version_id is a NOT NULL foreign key
// (src/db/schema.ts) — there is deliberately no fallback that fabricates a
// row here. Inventing a config version nobody reviewed or versioned would
// be worse than a clear error: this is an operational precondition
// (seed a firm_config_versions row for this tenant before it can take
// intake), not something an API route should paper over silently.
class FirmNotConfiguredError extends Error {}

// c74: the widget/landing page can pass where this inquiry came from —
// landingPage/campaignTag/isGoogleAds/directoryName/referralSource/
// phoneTrackingNumber — as an OPTIONAL JSON body. Reading it is best-effort
// on purpose: a missing or malformed body must never stop a session from
// being created (that would turn an analytics nice-to-have into an outage),
// so any read/parse failure here just means "no attribution captured yet"
// rather than a 400. Staff can always add or correct it later through
// PATCH /api/intake/sessions/[id]/attribution.
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function readOptionalAttributionInput(req: Request): Promise<LeadAttributionInput | null> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const input: LeadAttributionInput = {
    landingPage: isNonEmptyString(b.landingPage) ? b.landingPage : null,
    campaignTag: isNonEmptyString(b.campaignTag) ? b.campaignTag : null,
    isGoogleAds: b.isGoogleAds === true,
    directoryName: isNonEmptyString(b.directoryName) ? b.directoryName : null,
    referralSource: isNonEmptyString(b.referralSource) ? b.referralSource : null,
    phoneTrackingNumber: isNonEmptyString(b.phoneTrackingNumber) ? b.phoneTrackingNumber : null,
  };
  const hasAnySignal = input.isGoogleAds || [input.landingPage, input.campaignTag, input.directoryName, input.referralSource, input.phoneTrackingNumber].some(Boolean);
  return hasAnySignal ? input : null;
}

// Creates a new intake session for the (currently single, dev-hardcoded)
// tenant this deployment serves — see src/tenancy/devTenant.ts's own
// comment. Real per-firm resolution (which firm's embedded widget the
// visitor is on) is out of scope for this card.
export async function POST(req: Request) {
  const tenantId = getDevTenantId();
  const { withTenant } = await import("@/tenancy/withTenant");
  const attributionInput = await readOptionalAttributionInput(req);

  try {
    const session = await withTenant(tenantId, async (tx) => {
      const [config] = await tx
        .select({ id: firmConfigVersions.id })
        .from(firmConfigVersions)
        .where(eq(firmConfigVersions.tenantId, tenantId))
        .orderBy(desc(firmConfigVersions.effectiveFrom))
        .limit(1);

      if (!config) {
        throw new FirmNotConfiguredError();
      }

      const [created] = await tx
        .insert(intakeSessions)
        .values({
          tenantId,
          currentNode: "classify_caller",
          language: "en",
          channel: "web_chat",
          collectedAnswers: {},
          firmConfigVersionId: config.id,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to create intake session.");
      }

      await tx.insert(intakeEvents).values({
        tenantId,
        intakeSessionId: created.id,
        eventType: "session_started",
        actorType: "system",
        payload: { channel: "web_chat" },
        firmConfigVersionId: config.id,
      });

      if (attributionInput) {
        const { upsertLeadAttribution } = await import("@/engines/intake/attribution/service");
        await upsertLeadAttribution(tx, tenantId, created.id, attributionInput);
      }

      return created;
    });

    return NextResponse.json(
      {
        id: session.id,
        currentNode: session.currentNode,
        collectedAnswers: session.collectedAnswers,
        prompt: getPrompt("classify_caller", {}),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof FirmNotConfiguredError) {
      return NextResponse.json(
        {
          error:
            "This firm has no active configuration yet. Please try again later or contact the firm directly.",
        },
        { status: 503 }
      );
    }
    throw err;
  }
}
