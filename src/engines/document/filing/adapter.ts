// c86 — e-filing vendor seam. Modeled on ../signature/service.ts's
// EnvelopeDispatchAdapter: a real vendor (eFileTexas, federal CM/ECF where
// supported) is wired in later by calling setEfilingAdapter(); until then
// every submission fails closed through vendor.efiling (VENDOR_GATES.efiling
// — "Filing vendor terms and costs need review", c86's own open question).

import { requireApproval } from "@/compliance/approvals";
import { VENDOR_GATES } from "../gates";

export interface EfilingSubmitInput {
  tenantId: string;
  filingId: string;
  court: string;
  filingType: string;
}

export interface EfilingSubmitResult {
  vendorFilingId: string;
}

export interface EfilingAdapter {
  readonly name: string;
  submit(input: EfilingSubmitInput): Promise<EfilingSubmitResult>;
}

/** No e-filing vendor is wired yet: every call fails closed through vendor.efiling. */
export class UnavailableEfilingAdapter implements EfilingAdapter {
  readonly name = "unavailable";
  async submit(input: EfilingSubmitInput): Promise<EfilingSubmitResult> {
    requireApproval(VENDOR_GATES.efiling.key, { action: "document.filing.submit", tenantId: input.tenantId });
    // requireApproval always throws while the gate is pending; reachable only
    // once a real adapter is swapped in with setEfilingAdapter().
    throw new Error("UnavailableEfilingAdapter: no e-filing vendor configured.");
  }
}

let efilingAdapter: EfilingAdapter = new UnavailableEfilingAdapter();

export function setEfilingAdapter(next: EfilingAdapter | null): void {
  efilingAdapter = next ?? new UnavailableEfilingAdapter();
}

export function getEfilingAdapter(): EfilingAdapter {
  return efilingAdapter;
}
