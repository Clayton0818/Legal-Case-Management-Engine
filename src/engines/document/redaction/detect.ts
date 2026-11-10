// c88 — heuristic (non-AI) candidate-span detection for the redaction tool.
// Pure: no I/O, no vendor calls, deterministic regex + known-minor name
// matching only. Deliberately simple and auditable rather than clever: a
// human confirms every span before anything is permanently removed, so false
// positives are cheap (the reviewer skips them) while false negatives are
// not, which is why the patterns below favour recall.
//
// An AI-assisted suggestion step (e.g. a model call to catch sensitive text
// these patterns miss) is a plausible future enhancement, but it would first
// need to go through this codebase's vendor-gate pattern
// (src/compliance/gates.ts VENDOR_GATES.aiModel) — out of scope here on
// purpose; see the c88 PR description.

import type { RedactionSpan, RedactionCategory } from "@/db/tables/document";

export type { RedactionSpan, RedactionCategory };

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * A generic account-number pattern: 8–17 digits, optionally grouped with
 * spaces or dashes every 4. Deliberately broad (recall over precision — see
 * header note); a plain 10-digit phone number will also match, which is why
 * every suggestion is reviewed, never auto-applied.
 */
const ACCOUNT_NUMBER = /\b\d{4}[ -]?\d{4}[ -]?\d{1,9}\b/g;

function overlaps(spans: readonly RedactionSpan[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start);
}

/** Regex-based spans (SSN, generic account numbers). Pure. SSN wins on overlap (it is the more specific pattern). */
export function detectPatternSpans(text: string): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  for (const m of text.matchAll(SSN)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!overlaps(spans, start, end)) spans.push({ start, end, category: "ssn" });
  }
  for (const m of text.matchAll(ACCOUNT_NUMBER)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!overlaps(spans, start, end)) spans.push({ start, end, category: "account_number" });
  }
  return spans.sort((a, b) => a.start - b.start);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive matches of any of `names` in `text`. Pure. */
export function detectNameSpans(text: string, names: readonly string[]): RedactionSpan[] {
  const spans: RedactionSpan[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "giu");
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!overlaps(spans, start, end)) spans.push({ start, end, category: "minor_name" });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * All candidate spans, sorted and de-duplicated. Pure. A pattern match
 * (ssn/account_number) wins over a name match on overlap, since digits
 * matching a known minor's name is very unlikely and the pattern is more
 * specific.
 */
export function detectRedactionCandidates(text: string, minorNames: readonly string[] = []): RedactionSpan[] {
  const patternSpans = detectPatternSpans(text);
  const nameSpans = detectNameSpans(text, minorNames).filter((n) => !overlaps(patternSpans, n.start, n.end));
  return [...patternSpans, ...nameSpans].sort((a, b) => a.start - b.start);
}

export interface SpanProblem {
  index: number;
  message: string;
}

/** Validate spans a human confirmed: in bounds, non-overlapping, sorted. Pure. */
export function validateSpans(textLength: number, spans: readonly RedactionSpan[]): SpanProblem[] {
  const problems: SpanProblem[] = [];
  let prevEnd = -1;
  spans.forEach((s, i) => {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end <= s.start || s.end > textLength) {
      problems.push({ index: i, message: "Span is out of bounds." });
      return;
    }
    if (s.start < prevEnd) problems.push({ index: i, message: "Spans must be sorted and non-overlapping." });
    prevEnd = s.end;
  });
  return problems;
}

const PLACEHOLDER: Record<RedactionCategory, string> = {
  ssn: "[REDACTED-SSN]",
  account_number: "[REDACTED-ACCOUNT]",
  minor_name: "[REDACTED-NAME]",
};

/**
 * Apply confirmed spans to `text`, permanently replacing each one with a
 * fixed, category-labelled placeholder — the original characters are not in
 * the output at all (not merely masked). Pure. Spans must already be
 * validated and are applied left to right regardless of input order.
 */
export function applyRedactionSpans(text: string, spans: readonly RedactionSpan[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const s of sorted) {
    out += text.slice(cursor, s.start) + PLACEHOLDER[s.category];
    cursor = s.end;
  }
  out += text.slice(cursor);
  return out;
}
