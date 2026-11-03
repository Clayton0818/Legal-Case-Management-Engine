# c86 — implementation notes (first slice: domain logic, gated vendor seam, DB service)

Spec: [`c86-file-with-court-and-track-service.md`](./c86-file-with-court-and-track-service.md).
Code: `src/engines/document/filing/{rules,adapter,service}.ts` with `rules.test.ts` and `adapter.test.ts`. Tables: `court_filings`, `filing_service_records` in `src/db/tables/document.ts` (MIGRATION NOTES 11).

## What this slice builds

| Piece | Function | Spec reference |
|---|---|---|
| Only a draft filing against an attorney-approved document may be submitted | `canSubmitFiling()` | §5 rule 1, criterion 1 |
| The court's decision can be recorded only once, while the filing is `submitted` | `canRecordDecision()`, `recordFilingDecision()` | §4.3, criterion 3 |
| A rejection requires a reason; a failed service attempt requires a reason | `recordFilingDecision()`, `completeServiceRecord()` | §5 rule 3, criterion 3 |
| Service is tracked only once the court has accepted the filing | `canRecordService()`, `openServiceRecord()` | §4.4, criterion 5 |
| The stamped copy can be attached only to an accepted filing, and only from the same matter | `canAttachStampedCopy()`, `attachStampedCopy()` | §4.5, criterion 6 |
| A rejected filing is terminal — no "resubmit" operation exists | `isTerminal()` | "Resubmitting a rejected filing" |
| The vendor call fails closed through `vendor.efiling` until a real adapter is wired in (modeled on c4's `EnvelopeDispatchAdapter`) | `UnavailableEfilingAdapter`, `setEfilingAdapter()`/`getEfilingAdapter()`, `submitFiling()` | §4.2, criterion 2 |
| Opening or deciding a filing is a lawyer-level action; submitting and recording service need ordinary write access | `requireLawyer()`, `requireWrite()` in `service.ts` | §5 rule 2 |
| Every create, submit, decision, service event and stamped-copy attachment is audited | `audit()` calls throughout `service.ts`, `auditBlocked()` on a gated block | §5 rule 4 |

Acceptance criteria 1–6 are covered: 1 and parts of 3/5/6 by the pure `rules.test.ts` (12 tests) and `adapter.test.ts` (4 tests); the full DB-backed paths (2, remaining parts of 3/4/5/6) are implemented in `service.ts` but not exercised by a dedicated database test in this slice — see below.

## Deliberately not in this slice

No real e-filing vendor, no API routes, no admin UI, and no worker-tick hook to poll vendor status — the same staged approach c4's own first PR took for e-signature ("NOT in this slice… routes, admin UI, and the worker-tick hook"). No database integration test: `service.ts` reuses the exact loader/permission/audit patterns already proven against Postgres by `signature/service.ts` and `document.db.test.ts` (which this PR cannot run locally without `DATABASE_URL`), so this slice leans on `npm run typecheck` and the pure test suites instead of adding an unverified DB test file; a follow-up PR should add one alongside the routes. No automatic ingestion of the stamped copy or proof of service from the vendor — both are ordinary document uploads staff link in by hand. No `supersedesFilingId` link from a re-filed version back to the one it replaces (open question 1 in the spec).

## Compliance

Filing vendor terms, costs and data handling need review before `vendor.efiling` is approved (gate reviewer: vendor DPA) — until then every submission fails closed with a visible placeholder, by design. This feature never judges legal sufficiency, timeliness or correctness of service; those stay lawyer decisions. The spec's open questions still stand: which vendor, whether CM/ECF is in scope for the pilot, and whether "served" parties should be restricted to the matter's indexed conflict-check parties.
