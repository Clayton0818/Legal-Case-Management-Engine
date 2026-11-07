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
import { PERSONAL_INJURY_RULE_GATES } from "../gates";
import { PERSONAL_INJURY_PACK, PERSONAL_INJURY_RULE_KEYS } from "./personalInjury";
import { applicableQuestions, evaluateSignals, missingRequired, renderQuestion } from "./questions";
import { stableStringify, validatePack } from "./validate";

describe("Personal Injury pack content (c105)", () => {
  const pack = PERSONAL_INJURY_PACK;

  it("is structurally valid against the real gate registry", () => {
    expect(validatePack(pack, hasGate)).toEqual([]);
  });

  it("covers the five intake matter areas from the card note", () => {
    expect(pack.intake.matterTypes.map((t) => t.id)).toEqual([
      "car_truck_crash",
      "slip_and_fall",
      "dog_bite",
      "workplace_injury",
      "wrongful_death",
    ]);
  });

  it("asks safety first, then parties (conflict check), then case details — and date of injury is the first case question", () => {
    const order = applicableQuestions(pack, "car_truck_crash").map((q) => q.group);
    const firstIndex = (g: string) => order.indexOf(g as never);
    expect(firstIndex("safety")).toBe(0);
    expect(firstIndex("parties")).toBeLessThan(firstIndex("case"));

    const caseQuestions = applicableQuestions(pack, "car_truck_crash").filter((q) => q.group === "case");
    expect(caseQuestions[0]!.id).toBe("date_of_injury");

    const woundfulDeathCase = applicableQuestions(pack, "wrongful_death").filter((q) => q.group === "case");
    expect(woundfulDeathCase[0]!.id).toBe("date_of_injury");
  });

  it("indexes the at-fault party, insurer, co-defendant, and opposing counsel; the at-fault party blocks a clear result when unnamed", () => {
    const roles = new Map(pack.conflicts.partyRoles.map((r) => [r.id, r]));
    for (const id of ["at_fault_party", "insurance_carrier", "co_defendant", "opposing_counsel"]) {
      expect(roles.get(id)).toBeDefined();
    }
    expect(roles.get("at_fault_party")!.adverseByDefault).toBe(true);
    expect(roles.get("at_fault_party")!.askAtIntake).toBe(true);
    expect(roles.get("at_fault_party")!.blocksClearIfUnnamed).toBe(true);
  });

  it("indexes decedent beneficiaries for wrongful-death matters only", () => {
    const beneficiary = pack.conflicts.partyRoles.find((r) => r.id === "decedent_beneficiary")!;
    expect(beneficiary.matterTypes).toEqual(["wrongful_death"]);
  });

  it("holds no rule values: every Texas rule is a gated lawyer tool, and no literal day/month/year/percent number appears anywhere in the pack", () => {
    for (const r of pack.deadlines.rules) {
      expect(r.audience).toBe("lawyer_tool");
      expect(r.gateKey).toMatch(/^rules\./);
      expect(hasGate(r.gateKey)).toBe(true);
    }
    const text = stableStringify(pack);
    expect(text).not.toMatch(/\b\d+\s*(days?|months?|years?)\b/i);
    expect(text).not.toMatch(/\d+\s*%/);
  });

  it("reuses the shared limitation-periods and fee-agreement-terms gates rather than redefining them", () => {
    const statuteRule = pack.deadlines.rules.find((r) => r.id === "statute_of_limitations")!;
    expect(statuteRule.gateKey).toBe("rules.limitation_periods");
    const feeRule = pack.deadlines.rules.find((r) => r.id === "contingency_fee_agreement_rule")!;
    expect(feeRule.gateKey).toBe("rules.fee_agreement_terms");
    expect(pack.billing.feeTermsGateKey).toBe("rules.fee_agreement_terms");
    expect(pack.billing.trustGateKey).toBe("rules.trust_accounting");
  });

  it("defines its own gate for lien resolution before trust disbursement, reviewed by both an attorney and a CPA", () => {
    const lienRule = pack.deadlines.rules.find((r) => r.id === "lien_resolution_before_disbursement")!;
    expect(lienRule.gateKey).toBe(PERSONAL_INJURY_RULE_KEYS.lienResolutionBeforeDisbursement);
    expect(PERSONAL_INJURY_RULE_GATES.lienResolutionBeforeDisbursement.reviewers).toContain("attorney");
    expect(PERSONAL_INJURY_RULE_GATES.lienResolutionBeforeDisbursement.reviewers).toContain("cpa");
  });

  it("defaults to contingency fee and offers it among the fee types", () => {
    expect(pack.billing.defaultFeeType).toBe("contingency");
    expect(pack.billing.offeredFeeTypes).toContain("contingency");
  });

  it("ties a limitation-date-verification task and a lien-resolution task to a lawyer", () => {
    const opening = pack.tasks.lists.find((l) => l.id === "pi_opening")!;
    const limitationTask = opening.tasks.find((t) => t.ruleRef === "statute_of_limitations")!;
    expect(limitationTask.assigneeRole).toBe("lawyer");

    const disbursement = pack.tasks.lists.find((l) => l.id === "disbursement")!;
    const lienTask = disbursement.tasks.find((t) => t.ruleRef === "lien_resolution_before_disbursement")!;
    expect(lienTask.assigneeRole).toBe("lawyer");
  });

  it("follows matter-type-specific questions (workers' comp, dog history, wrongful-death beneficiaries)", () => {
    expect(applicableQuestions(pack, "workplace_injury").map((q) => q.id)).toContain("workers_comp_claim_filed");
    expect(applicableQuestions(pack, "dog_bite").map((q) => q.id)).toContain("dog_bite_history");
    expect(applicableQuestions(pack, "car_truck_crash").map((q) => q.id)).not.toContain("dog_bite_history");
    expect(applicableQuestions(pack, "wrongful_death").map((q) => q.id)).toContain("decedent_beneficiaries");
    expect(applicableQuestions(pack, "wrongful_death").map((q) => q.id)).toContain("date_of_death");
    expect(applicableQuestions(pack, "car_truck_crash").map((q) => q.id)).not.toContain("date_of_death");
  });

  it("evaluates safety signals, failing towards alerting", () => {
    expect(evaluateSignals(pack, {})).toMatchObject({ safety: false, urgent: false, markDvSensitive: false });
    const unsure = evaluateSignals(pack, { safe_now: "unsure" });
    expect(unsure).toMatchObject({ safety: true, markDvSensitive: true, safetyQuestionIds: ["safe_now"] });
    expect(evaluateSignals(pack, { safe_to_contact: "not_safe" }).markDvSensitive).toBe(true);
  });

  it("lists missing required answers, including the health-coverage question that drives lien tracking", () => {
    const missing = missingRequired(pack, "car_truck_crash", { safe_now: "yes" });
    expect(missing).toContain("date_of_injury");
    expect(missing).toContain("health_coverage_at_time_of_injury");
    expect(missing).not.toContain("safe_now");
  });
});

describe("Personal Injury pack gates (c105)", () => {
  beforeEach(() => resetApprovalStateForTests());

  it("client wording is a visible placeholder until an attorney approves the draft", async () => {
    const q = PERSONAL_INJURY_PACK.intake.questions.find((x) => x.id === "date_of_injury")!;
    const pending = renderQuestion(q);
    expect(pending.approved).toBe(false);
    expect(isPlaceholder(pending.text)).toBe(true);
    const src = new InMemoryApprovalSource();
    src.approve({ gateKey: q.prompt.copyKey, reviewerKind: "attorney", approvedByName: "Test Attorney" });
    setApprovalSource(src);
    await refreshApprovals();
    expect(renderQuestion(q)).toEqual({ id: q.id, text: q.prompt.draft, approved: true });
    expect(legalCopy(PERSONAL_INJURY_PACK.intake.safety.notice.copyKey)).toMatch(/PENDING ATTORNEY REVIEW/);
  });

  it("the lien-resolution rule blocks until both an attorney and a CPA approve", () => {
    expect(() => requireApproval(PERSONAL_INJURY_RULE_KEYS.lienResolutionBeforeDisbursement, { action: "trust.disburse" })).toThrow(
      PendingApprovalError
    );
  });
});
