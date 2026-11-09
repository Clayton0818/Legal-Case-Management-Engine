// The CSV-exportable sections of the c101 cross-engine report. Lives here,
// not in the route file: Next.js only allows HTTP-method handlers and route
// config (dynamic, revalidate, ...) as exports of an app/**/route.ts, and
// `next build` fails its route type check on any other export.

export const REPORT_SECTIONS = [
  "matters-by-stage",
  "matters-by-practice-area",
  "overdue-tasks",
  "deadlines-upcoming",
  "conflict-checks-pending",
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export function isReportSection(value: string | null): value is ReportSection {
  return value !== null && (REPORT_SECTIONS as readonly string[]).includes(value);
}
