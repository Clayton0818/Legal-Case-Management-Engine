// Branding (founder direction, 2026-11-03): one accent color, firm-wide.
// Everything indigo/sky/blue-colored across the staff console -- links,
// pills, primary buttons -- re-tints from this single value. Owner or firm
// admin only (settings.manage); every change is logged.

import { withStaff } from "../_lib/load";
import { ColorPicker } from "./color-picker";

export const dynamic = "force-dynamic";

export default async function BrandingPage() {
  const { data, error } = await withStaff("branding", async ({ tx, tenantId }) => {
    const { getBranding } = await import("@/engines/all-engines/branding/service");
    return getBranding(tx, tenantId);
  });
  if (!data) return <p className="text-sm text-red-700">{error}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Branding</h1>
        <p className="mt-1 text-sm text-slate-600">
          Pick the firm&rsquo;s accent color. It carries through links, buttons and highlights across the whole staff console -- no other
          setting to change. Reset to the product default any time.
        </p>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <ColorPicker initialColor={data.brandAccentColor} />
      </section>
    </div>
  );
}
