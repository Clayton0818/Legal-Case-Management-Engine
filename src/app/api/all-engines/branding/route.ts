import { allEnginesRoute } from "@/app/api/all-engines/_lib/route";
import { readBody, optString } from "@/engines/all-engines/common/body";
import { getBranding, setBrandAccentColor } from "@/engines/all-engines/branding/service";

export const dynamic = "force-dynamic";

/** The firm's accent color (settings.manage to change; anyone signed in may read it, so the UI can render on-brand). */
export async function GET() {
  return allEnginesRoute("GET /api/all-engines/branding", ({ tx, tenantId }) => getBranding(tx, tenantId));
}

/** Set the firm's accent color: { color: "#5E5CE6" | null }. Firm admin only. Logged. */
export async function PUT(req: Request) {
  return allEnginesRoute("PUT /api/all-engines/branding", async ({ tx, tenantId, staff }) => {
    const body = await readBody(req);
    return setBrandAccentColor(tx, { tenantId, by: staff, color: optString(body, "color") });
  });
}
