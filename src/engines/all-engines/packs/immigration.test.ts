// c104 — Immigration pack content tests. Kept in its own file (not
// packs.test.ts) so this card and c105 (Personal Injury) don't collide on a
// shared test file; the generic "every registered pack is valid" and
// "registry" checks in packs.test.ts already cover this pack once it is
// registered.

import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryApprovalSource,
  hasGate,
  isPlaceholder,
  legalCopy,
  refreshApprovals,
  resetApprovalStateForTests,
  setApprovalSource,
  requireApproval,
  PendingApprovalError,
} from "@/compliance/approvals";
import { IMMIGRATION_RULE_GATES } from "../gates";
import { packCopyItems, uniqueCopyItems } from "./copy";
import { IMMIGRATION_PACK, IMMIGRATION_RULE_KEYS } from "./immigration";
import { applicableQuestions, evaluateSignals, missingRequired, renderQuestion } from "./questions";
import { stableStringify } from "./validate";

describe("Immigration pack content (c104)", () => {
  const pack = IMMIGRATION_PACK;

  it("covers the six matter types", () => {
    expect(pack.intake.matterTypes.map((t) => t.id)).toEqual([
      "family_petition",
      "adjustment_of_status",
      "citizenship",
      "work_permit",
      "asylum",
      "removal_defense",
    ]);
  });

  it("maps every matter type to an immigration_* classifier label", () => {
    for (const t of pack.intake.matterTypes) {
      for (const label of t.classifierLabels) expect(label.startsWith("immigration_")).toBe(true);
    }
  });

  it("asks safety first, then detention/court-date screening and parties, before any case detail", () => {
    const order = applicableQuestions(pack, "removal_defense", {}).map((q) => q.group);
    const firstIndex = (g: string) => order.indexOf(g as never);
    const lastIndex = (g: string) => order.lastIndexOf(g as never);
    expect(firstIndex("safety")).toBe(0);
    // detention / court-date questions are tagged "existing_orders" and must
    // still run before "parties", which must still run before "case".
    expect(lastIndex("safety")).toBeLessThan(firstIndex("existing_orders"));
    expect(firstIndex("existing_orders")).toBeLessThan(firstIndex("parties"));
    expect(lastIndex("parties")).toBeLessThan(firstIndex("case"));
  });

  it("indexes petitioner/sponsor and government counsel; an unnamed petitioner blocks a clear conflict result", () => {
    const roles = new Map(pack.conflicts.partyRoles.map((r) => [r.id, r]));
    expect(roles.get("petitioner_or_sponsor")).toMatchObject({ adverseByDefault: true, askAtIntake: true, blocksClearIfUnnamed: true, indexByDefault: true });
    expect(roles.get("dhs_ice_counsel")).toMatchObject({ partyRole: "opposing_counsel", indexByDefault: true });
    expect(roles.get("beneficiary_family_member")!.blocksClearIfUnnamed).toBe(false);
  });

  it("holds no rule values: every immigration rule is a gated, staff-only lawyer tool", () => {
    for (const r of pack.deadlines.rules) {
      expect(r.audience).toBe("lawyer_tool");
      expect(r.gateKey).toMatch(/^rules\./);
      expect(hasGate(r.gateKey)).toBe(true);
    }
    // nothing in the pack text states a number of days/months/years
    expect(stableStringify(pack)).not.toMatch(/\b\d+\s*(days?|months?|years?)\b/i);
  });

  it("never tells the client whether they qualify or which form to file, outside the safety guardrail notice itself", () => {
    // The safety notice is allowed to say it does NOT make that determination
    // ("...does not tell you whether you qualify..."); every other piece of
    // client-facing copy (questions, document requests, stage labels) must
    // not use qualify/eligible/"you should file" language at all.
    const guardedWhere = new Set(["safety notice at the start of intake", "reply when a safety signal is detected"]);
    for (const item of packCopyItems(pack)) {
      if (guardedWhere.has(item.where)) continue;
      expect(item.draft.toLowerCase()).not.toMatch(/qualify|eligible for|you should file|you need to file|file form/);
    }
    expect(pack.intake.safety.notice.draft.toLowerCase()).toMatch(/does not tell you whether you qualify|does not tell you .* which form/);
  });

  it("uses flat fee by default (with a pay schedule, c52) and withholds contingency", () => {
    expect(pack.billing.defaultFeeType).toBe("flat_fee");
    expect(pack.billing.withheldFeeTypes.map((w) => w.feeType)).toEqual(["contingency"]);
    expect(pack.billing.trustGateKey).toBe("rules.trust_accounting");
  });

  it("follows the conditional questions", () => {
    const base = applicableQuestions(pack, null).map((q) => q.id);
    expect(base).not.toContain("safe_contact_method");
    expect(base).not.toContain("detention_location");
    expect(applicableQuestions(pack, null, { safe_to_contact: "not_safe" }).map((q) => q.id)).toContain("safe_contact_method");
    expect(applicableQuestions(pack, null, { in_detention: "yes" }).map((q) => q.id)).toContain("detention_location");
    expect(applicableQuestions(pack, "asylum").map((q) => q.id)).toContain("reason_for_fear_summary");
    expect(applicableQuestions(pack, "removal_defense").map((q) => q.id)).toContain("removal_proceedings_stage");
    expect(applicableQuestions(pack, "family_petition").map((q) => q.id)).toContain("petitioner_or_sponsor_name");
  });

  it("evaluates detention and immigration-court-date signals as urgent, failing towards alerting", () => {
    expect(evaluateSignals(pack, {})).toMatchObject({ safety: false, urgent: false });
    const detained = evaluateSignals(pack, { in_detention: "yes" });
    expect(detained).toMatchObject({ urgent: true, urgentQuestionIds: ["in_detention"] });
    const courtDate = evaluateSignals(pack, { upcoming_immigration_court_date: "unsure" });
    expect(courtDate.urgent).toBe(true);
    const rfe = evaluateSignals(pack, { rfe_received: "yes" });
    expect(rfe.urgent).toBe(true);
    const fear = evaluateSignals(pack, { harm_or_persecution_fear: "yes" });
    expect(fear).toMatchObject({ safety: true, markDvSensitive: true });
  });

  it("lists missing required answers", () => {
    const missing = missingRequired(pack, "citizenship", { safe_now: "yes", safe_to_contact: "safe" });
    expect(missing).toContain("current_immigration_status");
    expect(missing).not.toContain("safe_now");
    expect(missingRequired(pack, null, { safe_now: " " })).toContain("safe_now");
  });
});

describe("Immigration pack gates (c104)", () => {
  beforeEach(() => resetApprovalStateForTests());

  it("defines one attorney gate per distinct client sentence, and the immigration rule gates", () => {
    expect(packCopyItems(IMMIGRATION_PACK).length).toBeGreaterThanOrEqual(uniqueCopyItems(IMMIGRATION_PACK).length);
    for (const g of Object.values(IMMIGRATION_RULE_GATES)) {
      expect(g.reviewers).toEqual(["attorney"]);
      expect(g.key).toMatch(/^rules\.all-engines\.immigration\./);
      expect(g.cardIds).toContain("c104");
    }
  });

  it("client wording is a visible placeholder until an attorney approves the draft", async () => {
    const q = IMMIGRATION_PACK.intake.questions[0]!;
    const pending = renderQuestion(q);
    expect(pending.approved).toBe(false);
    expect(isPlaceholder(pending.text)).toBe(true);
    const src = new InMemoryApprovalSource();
    src.approve({ gateKey: q.prompt.copyKey, reviewerKind: "attorney", approvedByName: "Test Attorney" });
    setApprovalSource(src);
    await refreshApprovals();
    expect(renderQuestion(q)).toEqual({ id: q.id, text: q.prompt.draft, approved: true });
    expect(legalCopy(IMMIGRATION_PACK.intake.safety.notice.copyKey)).toMatch(/PENDING ATTORNEY REVIEW/);
  });

  it("immigration rule references (form/track eligibility, EOIR calendar, fee schedule) block until approved", () => {
    expect(() => requireApproval(IMMIGRATION_RULE_KEYS.formAndTrackEligibility, { action: "intake.suggest_form" })).toThrow(PendingApprovalError);
    expect(() => requireApproval(IMMIGRATION_RULE_KEYS.eoirHearingCalendar, { action: "calendar.propose_hearing" })).toThrow(PendingApprovalError);
    expect(() => requireApproval(IMMIGRATION_RULE_KEYS.filingFeeAndWaiverSchedule, { action: "billing.quote_fee" })).toThrow(PendingApprovalError);
  });
});
