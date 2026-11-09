// Approval gates owned by the All-engines engine (c99, c102, c103, c104).
//
// Nothing here is approved. Until a reviewer's sign-off is recorded
// (`npm run compliance -- approve …`):
//  - every client-facing sentence of a practice-area pack renders as a visible
//    "[PENDING ATTORNEY REVIEW …]" placeholder via legalCopy();
//  - every Texas family-law rule reference and every Immigration rule
//    reference blocks (requireApproval throws PendingApprovalError) in
//    whichever engine tries to apply it.
// Drafts are proposals for the reviewer, not approved wording and not legal
// advice. Shared gates (rules.court_deadlines, rules.limitation_periods,
// rules.fee_agreement_terms, rules.trust_accounting) are reused, not redefined.

import { defineGate, type Gate } from "@/compliance/approvals";
import { RULE_GATES } from "@/compliance/gates";
import { listPacks } from "./packs/registry";
import { uniqueCopyItems } from "./packs/copy";
import { FAMILY_RULE_KEYS } from "./packs/family";
import { IMMIGRATION_RULE_KEYS } from "./packs/immigration";

export { RULE_GATES };

// Client portal copy (c11, c112) lives with the portal (src/portal/gates.ts);
// re-exported here so loadAllGates() — the compliance CLI and the admin
// "pending approvals" page — lists it.
export { PORTAL_COPY_GATES, PORTAL_GATE_KEYS } from "@/portal/gates";

const ATTORNEY = ["attorney"] as const;

/** Texas family-law rule gates (c103). Values never live in code; these gate their use. */
export const FAMILY_RULE_GATES = {
  packContent: defineGate({
    key: FAMILY_RULE_KEYS.packContent,
    cardIds: ["c103"],
    reviewers: [...ATTORNEY],
    description: "Family Law pack as a whole (matter types, questions, party roles, checklists, stages, task lists) reviewed by a Texas family-law attorney",
  }),
  starterTemplates: defineGate({
    key: FAMILY_RULE_KEYS.starterTemplates,
    cardIds: ["c103", "c85", "c39"],
    reviewers: [...ATTORNEY],
    description: "Family Law starter templates (petitions, parenting plan, inventory, disclosures, final orders): content and licensing",
  }),
  divorceWaitingPeriod: defineGate({
    key: FAMILY_RULE_KEYS.divorceWaitingPeriod,
    cardIds: ["c103", "c92"],
    reviewers: [...ATTORNEY],
    description: "Texas waiting period before a divorce can be granted, and its exceptions (lawyer tool only)",
  }),
  residencyVenue: defineGate({
    key: FAMILY_RULE_KEYS.residencyVenue,
    cardIds: ["c103", "c73"],
    reviewers: [...ATTORNEY],
    description: "Texas residency and venue requirements for family cases (lawyer tool only; never an automatic decline)",
  }),
  childSupportGuidelines: defineGate({
    key: FAMILY_RULE_KEYS.childSupportGuidelines,
    cardIds: ["c103"],
    reviewers: [...ATTORNEY],
    description: "Texas child-support guideline calculation: percentages, income definitions, caps (lawyer worksheet only)",
  }),
  possessionSchedule: defineGate({
    key: FAMILY_RULE_KEYS.possessionSchedule,
    cardIds: ["c103", "c91"],
    reviewers: [...ATTORNEY],
    description: "Texas standard parenting-time (possession) schedule rules used to draft a calendar for the lawyer",
  }),
  protectiveOrderTiming: defineGate({
    key: FAMILY_RULE_KEYS.protectiveOrderTiming,
    cardIds: ["c103", "c66", "c92"],
    reviewers: [...ATTORNEY],
    description: "Protective-order hearing timing and temporary-order duration (real clock; lawyer tool only)",
  }),
  modificationEligibility: defineGate({
    key: FAMILY_RULE_KEYS.modificationEligibility,
    cardIds: ["c103"],
    reviewers: [...ATTORNEY],
    description: "When and on what grounds a custody/support order may be modified (prompts for the lawyer; the product never decides)",
  }),
  statutoryForms: defineGate({
    key: FAMILY_RULE_KEYS.statutoryForms,
    cardIds: ["c103", "c85"],
    reviewers: [...ATTORNEY],
    description: "Statutory warnings, notices and forms required in Texas family filings",
  }),
} as const;

/**
 * Immigration rule gates (c104). Federal law (8 CFR, EOIR); values never
 * live in code. Several of these exist specifically because unlicensed
 * ("notario") immigration advice is a documented source of real harm and
 * Texas has its own rules against it — see
 * docs/product/features/all-engines/c104-immigration-pack.md.
 */
export const IMMIGRATION_RULE_GATES = {
  packContent: defineGate({
    key: IMMIGRATION_RULE_KEYS.packContent,
    cardIds: ["c104"],
    reviewers: [...ATTORNEY],
    description: "Immigration pack as a whole (matter types, questions, party roles, checklists, stages, task lists) reviewed by a licensed immigration attorney",
  }),
  starterTemplates: defineGate({
    key: IMMIGRATION_RULE_KEYS.starterTemplates,
    cardIds: ["c104", "c85", "c39"],
    reviewers: [...ATTORNEY],
    description: "Immigration starter templates (USCIS/EOIR forms, G-28/EOIR-28, supporting evidence index): content and licensing",
  }),
  formAndTrackEligibility: defineGate({
    key: IMMIGRATION_RULE_KEYS.formAndTrackEligibility,
    cardIds: ["c104"],
    reviewers: [...ATTORNEY],
    description: "Which immigration forms or process track may fit a case — a lawyer-only prompt; the product never tells a client whether they qualify or which form to file (notario/UPL risk)",
  }),
  uscisNoticeDeadlines: defineGate({
    key: IMMIGRATION_RULE_KEYS.uscisNoticeDeadlines,
    cardIds: ["c104", "c91"],
    reviewers: [...ATTORNEY],
    description: "USCIS Request for Evidence, biometrics and interview response/appearance timing (lawyer tool only)",
  }),
  eoirHearingCalendar: defineGate({
    key: IMMIGRATION_RULE_KEYS.eoirHearingCalendar,
    cardIds: ["c104", "c91", "c66"],
    reviewers: [...ATTORNEY],
    description: "Immigration court (EOIR) master calendar and merits hearing timing used to propose matter-calendar entries",
  }),
  naturalizationEligibilityTiming: defineGate({
    key: IMMIGRATION_RULE_KEYS.naturalizationEligibilityTiming,
    cardIds: ["c104"],
    reviewers: [...ATTORNEY],
    description: "Continuous residence, physical presence and other naturalization timing eligibility rules (lawyer worksheet only)",
  }),
  removalDefenseReliefEligibility: defineGate({
    key: IMMIGRATION_RULE_KEYS.removalDefenseReliefEligibility,
    cardIds: ["c104"],
    reviewers: [...ATTORNEY],
    description: "Available forms of relief from removal and their eligibility screening questions (prompts for the lawyer; the product never decides)",
  }),
  filingFeeAndWaiverSchedule: defineGate({
    key: IMMIGRATION_RULE_KEYS.filingFeeAndWaiverSchedule,
    cardIds: ["c104", "c52"],
    reviewers: [...ATTORNEY],
    description: "USCIS/EOIR filing-fee schedule and fee-waiver eligibility criteria",
  }),
} as const;

/** One attorney copy gate per client-facing sentence in every registered pack. */
function definePackCopyGates(): Gate[] {
  const out: Gate[] = [];
  for (const pack of listPacks()) {
    for (const item of uniqueCopyItems(pack)) {
      out.push(
        defineGate({
          key: item.copyKey,
          cardIds: [pack.cardId, "c102"],
          reviewers: [...ATTORNEY],
          description: `${pack.label} pack: ${item.where} (client-facing)`,
          draft: item.draft,
        })
      );
    }
  }
  return out;
}

export const PACK_COPY_GATES: readonly Gate[] = definePackCopyGates();

export const ALL_ENGINES_GATE_KEYS: readonly string[] = [
  ...Object.values(FAMILY_RULE_GATES).map((g) => g.key),
  ...Object.values(IMMIGRATION_RULE_GATES).map((g) => g.key),
  ...PACK_COPY_GATES.map((g) => g.key),
];

/** Shared gates this engine's packs depend on (shown on the admin pages). */
export const ALL_ENGINES_SHARED_GATE_KEYS: readonly string[] = [
  RULE_GATES.courtDeadlines.key,
  RULE_GATES.limitationPeriods.key,
  RULE_GATES.feeAgreementTerms.key,
  RULE_GATES.trustAccounting.key,
];
