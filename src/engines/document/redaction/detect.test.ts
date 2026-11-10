import { describe, expect, it } from "vitest";
import { applyRedactionSpans, detectNameSpans, detectPatternSpans, detectRedactionCandidates, validateSpans } from "./detect";

describe("detectPatternSpans", () => {
  it("finds SSNs", () => {
    const text = "Client SSN: 123-45-6789, filed on record.";
    const spans = detectPatternSpans(text);
    expect(spans).toEqual([{ start: 12, end: 23, category: "ssn" }]);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe("123-45-6789");
  });

  it("finds a generic account number and does not double-count an SSN as one", () => {
    const text = "Account 4012888812345678 was debited.";
    const spans = detectPatternSpans(text);
    expect(spans.map((s) => s.category)).toEqual(["account_number"]);
  });

  it("finds nothing in ordinary prose", () => {
    expect(detectPatternSpans("The hearing is scheduled for next Tuesday.")).toEqual([]);
  });
});

describe("detectNameSpans", () => {
  it("matches whole words only, case-insensitively, and de-duplicates names", () => {
    const text = "Minor child Jamie Lee lives with Jamie Lee's mother; Jamieson is unrelated.";
    const spans = detectNameSpans(text, ["Jamie Lee", "jamie lee"]);
    expect(spans).toHaveLength(2);
    for (const s of spans) expect(text.slice(s.start, s.end).toLowerCase()).toBe("jamie lee");
  });

  it("ignores blank/too-short names", () => {
    expect(detectNameSpans("A B C", ["", "  ", "A"])).toEqual([]);
  });
});

describe("detectRedactionCandidates", () => {
  it("combines pattern and name spans into one sorted, non-overlapping list", () => {
    const text = "Jane Doe, SSN 123-45-6789, account 4012888812345678.";
    const spans = detectRedactionCandidates(text, ["Jane Doe"]);
    expect(spans.map((s) => s.category)).toEqual(["minor_name", "ssn", "account_number"]);
    expect(spans.every((s, i) => i === 0 || s.start >= spans[i - 1]!.end)).toBe(true);
  });

  it("returns nothing for text with no matches and no minor names", () => {
    expect(detectRedactionCandidates("No sensitive data here.")).toEqual([]);
  });
});

describe("validateSpans", () => {
  it("accepts sorted, non-overlapping, in-bounds spans", () => {
    expect(
      validateSpans(20, [
        { start: 0, end: 3, category: "ssn" },
        { start: 5, end: 10, category: "account_number" },
      ])
    ).toEqual([]);
  });

  it("rejects out-of-bounds, zero-length, and overlapping spans", () => {
    expect(validateSpans(10, [{ start: -1, end: 3, category: "ssn" }])).toHaveLength(1);
    expect(validateSpans(10, [{ start: 3, end: 3, category: "ssn" }])).toHaveLength(1);
    expect(validateSpans(10, [{ start: 3, end: 12, category: "ssn" }])).toHaveLength(1);
    expect(
      validateSpans(10, [
        { start: 0, end: 5, category: "ssn" },
        { start: 3, end: 8, category: "account_number" },
      ])
    ).toHaveLength(1);
  });
});

describe("applyRedactionSpans", () => {
  it("permanently replaces each span with a category placeholder, independent of input order", () => {
    const text = "SSN 123-45-6789 and name Jane Doe end.";
    const spans = [
      { start: 25, end: 33, category: "minor_name" as const },
      { start: 4, end: 15, category: "ssn" as const },
    ];
    const out = applyRedactionSpans(text, spans);
    expect(out).toBe("SSN [REDACTED-SSN] and name [REDACTED-NAME] end.");
    expect(out).not.toContain("123-45-6789");
    expect(out).not.toContain("Jane Doe");
  });

  it("is a no-op on an empty span list", () => {
    expect(applyRedactionSpans("hello world", [])).toBe("hello world");
  });
});
