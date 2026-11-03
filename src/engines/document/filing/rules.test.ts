import { describe, expect, it } from "vitest";
import { canAttachStampedCopy, canRecordDecision, canRecordService, canSubmitFiling, isTerminal } from "./rules";

describe("canSubmitFiling", () => {
  it("allows a draft filing against an attorney-approved document", () => {
    expect(canSubmitFiling("draft", "attorney_approved")).toEqual({ allowed: true });
  });
  it("refuses a filing that is not a draft", () => {
    expect(canSubmitFiling("submitted", "attorney_approved").allowed).toBe(false);
  });
  it("refuses a document that is not attorney-approved", () => {
    const d = canSubmitFiling("draft", "uploaded");
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/not attorney-approved/);
  });
});

describe("canRecordDecision", () => {
  it("only once the filing was submitted", () => {
    expect(canRecordDecision("submitted").allowed).toBe(true);
    expect(canRecordDecision("draft").allowed).toBe(false);
    expect(canRecordDecision("accepted").allowed).toBe(false);
    expect(canRecordDecision("rejected").allowed).toBe(false);
  });
});

describe("canRecordService and canAttachStampedCopy", () => {
  it("only once the court has accepted the filing", () => {
    for (const fn of [canRecordService, canAttachStampedCopy]) {
      expect(fn("accepted").allowed).toBe(true);
      expect(fn("draft").allowed).toBe(false);
      expect(fn("submitted").allowed).toBe(false);
      expect(fn("rejected").allowed).toBe(false);
    }
  });
});

describe("isTerminal", () => {
  it("only 'rejected' is terminal — a filing is never resubmitted in place", () => {
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("draft")).toBe(false);
    expect(isTerminal("submitted")).toBe(false);
    expect(isTerminal("accepted")).toBe(false);
  });
});
