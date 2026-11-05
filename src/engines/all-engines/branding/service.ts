// Branding (founder direction, 2026-11-03): the firm's own accent color.
// Firm admin only (settings.manage); logged via updateFirmSettings's own
// "firm_settings.updated" audit row.

import { getFirmSettings, updateFirmSettings } from "@/core/firmSettings";
import { FIRM, assertCan } from "@/core/permissions";
import type { TenantTx } from "@/tenancy/withTenant";
import type { StaffContext } from "../permissions/service";
import { AllEnginesError } from "../common/errors";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function getBranding(tx: TenantTx, tenantId: string): Promise<{ brandAccentColor: string | null }> {
  const settings = await getFirmSettings(tx, tenantId);
  return { brandAccentColor: settings.brandAccentColor };
}

/** `color` is a 6-digit hex like '#5E5CE6', or null to reset to the product default. */
export async function setBrandAccentColor(
  tx: TenantTx,
  input: { tenantId: string; by: StaffContext; color: string | null }
): Promise<{ brandAccentColor: string | null }> {
  const { tenantId, by, color } = input;
  assertCan(by.actor, "settings.manage", FIRM, by.config);
  if (color !== null && !HEX_COLOR.test(color)) {
    throw new AllEnginesError("Pick a color, or enter a 6-digit hex code like #5E5CE6.");
  }
  const updated = await updateFirmSettings(tx, tenantId, { brandAccentColor: color }, by.auditActor);
  return { brandAccentColor: updated.brandAccentColor };
}
