# c86 · File documents with the court and track service

**Card:** `c86` Document engine · File documents with the court and track service (Engineering, P1)

## 1. Summary

Submit an attorney-approved document version to the court through an e-filing vendor (eFileTexas; federal CM/ECF where the vendor supports it), track what the court did with it (submitted, accepted, rejected with a reason), track service of that filing on every other party who must receive it, and save the court-stamped copy back to the matter once staff have it. No filing goes out before a lawyer has approved the document, and before the client has signed off where c41 requires it — enforced by requiring the document itself be in the `attorney_approved` status, the same bar c4 already sets for a signature envelope, rather than a second check this card invents.

## 2. Users and problem

- **Lawyer / paralegal:** today files by hand through the court's own portal and tracks the result in email or a spreadsheet; nothing on the matter shows what was filed, when, or whether service is done.
- **Firm admin:** cannot see which matters have filings stuck "submitted" with no court decision, or service that never completed.
- **Client:** is not part of this feature directly; filing status can inform the client-facing stage/updates features (c54) later, out of scope here.

## 3. Scope

**In scope**
- A filing record per submission: type (petition, motion, response, notice, other), the court it goes to, status, and the vendor's own filing id once submitted.
- Submission to a vendor through a gated adapter seam (`vendor.efiling`) — no vendor is wired in this slice, so every submission fails closed with a visible pending placeholder, exactly like c4's signature dispatch.
- Recording the court's decision: accepted, or rejected with a required reason.
- Service tracking: one record per party that must be served, with method (e-filing, mail, certified mail, personal, other), status (pending, completed, failed with a required reason), and an optional proof-of-service document.
- Linking the court-stamped copy, once staff upload it to the matter through the existing document store (c84), back to its filing.

**Out of scope (this slice)**
- The actual eFileTexas / CM-ECF vendor integration (needs the vendor decision and DPA review — `vendor.efiling`).
- API routes and an admin UI page for staff to do any of the above (service.ts only; same staged approach c4's first slice took).
- A worker-tick hook that polls vendor status once a real adapter exists.
- Catching the court's own returned notices about a filing — that inbound channel belongs to the calendar-alerts engine (c64) and already lists `"efiling"` as a notice source; this engine never imports it and does not duplicate it.
- Generating the stamped copy automatically from the vendor's response; staff upload it like any other document and link it with `attachStampedCopy()`.
- Resubmitting a rejected filing in place. The lawyer corrects the underlying document (a new, separately re-approved version) and opens a new filing; a filing's status only ever moves forward.

## 4. Behaviour

1. **Draft.** A lawyer opens a filing against one `attorney_approved` document version, naming the filing type and the court. Nothing is sent yet.
2. **Submit.** Any staff member with write access submits the draft. The call is gated on `vendor.efiling`; until a vendor is approved and wired in, it returns a visible pending placeholder and nothing is sent, exactly like every other ungated vendor call in this product.
3. **Decide.** Once the vendor has a result, staff record it: `accepted` (optionally later paired with the stamped copy), or `rejected` with a required reason. A rejected filing is terminal — see "Resubmitting a rejected filing" above.
4. **Serve.** Once accepted, staff open one service record per party that must be served, by whichever method the firm actually used, and mark each completed (with optional proof) or failed (with a required reason).
5. **Stamped copy.** Once staff have the court's stamped copy, they upload it to the matter as usual (c84) and link it to the filing.

**Edge cases**
- A filing is never deleted; a rejection is final for that row (see above), matching the "never corrected in place" rule the signature envelope table already follows.
- A document with a newer version after a filing was opened does not retroactively invalidate the filing — that mirrors the signature envelope's own hash-binding question, which this slice intentionally leaves to a follow-up rather than guessing at the right behaviour.
- Service may be partial: some parties served, others still pending. Each party's record is independent.

## 5. Business rules

1. Only a document in `attorney_approved` status may be the subject of a filing (reuses c4's own bar; this card defines no bar of its own).
2. Opening or deciding a filing requires the lawyer-level permission (`documents.approve`); submitting and recording service require ordinary write access (`documents.write`).
3. A rejection must carry a reason; a failed service attempt must carry a reason. Both are required, not optional commentary.
4. Every create, submit, decision, service event and stamped-copy attachment is written to the audit trail (c6).
5. The vendor call itself is gated on `vendor.efiling` (shared gate, reviewers: vendor DPA) — filing vendor terms and costs need review before any real submission can occur.

## 6. Data model touchpoints

- **New tables** (`src/db/tables/document.ts`): `court_filings` (one row per submission; `documentId`, `filingType`, `court`, `status`, vendor fields, `stampedDocumentId`) and `filing_service_records` (one row per party served; `filingId`, `partyId`/`servedOnName`, `method`, `status`, `proofDocumentId`).
- **Reuse:** the shared `documents` table for both the filed version and the stamped copy / proof of service (both are ordinary versions in the existing store, never a second copy mechanism); `matters` for scoping.
- Neither table is ever deleted from — a rejected filing or failed service attempt stays in the history (MIGRATION NOTES 11 in `src/db/tables/document.ts`).

## 7. Notifications and visibility

- **Internal only.** Nothing here is client-facing. A filing's status could feed c53 (case health) or c54 (client updates) in a later slice; this one does not wire that.
- **Returned court notices** about a filing arrive through the calendar-alerts engine's existing inbound-mail channel (c64), not through this feature.

## 8. Dependencies

- **Needs:** c84 (document store, for the filed version, stamped copy and proof of service), c4 (sets the `attorney_approved` bar this card reuses), c41 (client sign-off upstream of that approval where required), the e-filing vendor decision + DPA (`vendor.efiling`).
- **Feeds:** c64 can later link a returned court notice to a `court_filings` row by cause number, once that matching exists; not required for this slice.

## 9. Compliance and review flags

- **Vendor review:** eFileTexas / CM-ECF terms, costs and data-handling need review before `vendor.efiling` is approved and any adapter is wired in (gate reviewer: vendor DPA).
- **No legal-sufficiency judgment:** this feature submits, tracks status and tracks service. It never decides whether a filing is legally sufficient, timely, or served correctly — those stay lawyer decisions, consistent with the product-wide rule that the AI never gives legal advice or decides a deadline.

## 10. Acceptance criteria

1. Given a document that is not `attorney_approved`, when a lawyer tries to open a filing against it, then the call is refused with a 409 naming the document's actual status.
2. Given a draft filing, when it is submitted and no e-filing vendor is approved, then the call returns a visible pending placeholder, the filing stays `draft`, and the attempt is recorded in the audit trail as blocked.
3. Given a `submitted` filing, when staff record a rejection without a reason, then the call is refused.
4. Given an `accepted` filing, when staff open a service record with neither a party id nor a served-on name, then the call is refused.
5. Given a `draft` or `submitted` filing, when staff try to open a service record, then the call is refused — service is only tracked once the court has accepted the filing.
6. Given a stamped copy belonging to a different matter, when staff try to attach it to a filing, then the call is refused.

## 11. Open questions for Clayton

1. Should a rejected filing's new, re-filed version be linked back to the row it replaces (an explicit `supersedesFilingId`), or is the audit trail enough to trace that by hand? Proposed: add the link in the follow-up PR that builds routes/UI, once real vendor rejection reasons show how firms actually use this.
2. eFileTexas vs. a aggregator (e.g. a filing-agent API some firms already use) — which vendor, and is federal CM/ECF in scope for the pilot at all given it varies by district?
3. Should "served" parties be restricted to the matter's indexed conflict-check parties (c56), or can staff free-text anyone not yet a party row? This slice allows free text (`servedOnName`) for anyone not yet a party row, which seems necessary for e.g. a process server or the court itself, but should be confirmed.
