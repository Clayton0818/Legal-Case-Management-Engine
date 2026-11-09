# Personal Injury pack (c105)

**Status: DRAFT.** Nothing in this pack is legal advice, settled Texas law, or
approved client-facing wording. **A licensed Texas personal-injury attorney
AND a CPA must review this pack's content, fee-agreement wording,
settlement-statement template and the lien-resolution/trust-disbursement rule
before any client sees them or any lawyer relies on them.**

## Scope

Implements board card `c105` — "All engines · Personal Injury pack" — as a
practice-area pack (`src/engines/all-engines/packs/personalInjury.ts`),
following the Family Law pack's pattern (`c103`, `./family.ts`): pure data
plugged into all five engines (intake, conflict-check, document,
calendar-alerts/calendar-core, billing-trust) through
`src/engines/all-engines/packs/registry.ts`.

Matter types, per the card note: car and truck crashes, slip and fall, dog
bites, workplace injury, and wrongful death.

### Intake

- Safety questions are asked first (same conservative defaults as every other
  pack: client contact marked DV-sensitive on a safety signal, no SMS or
  voicemail by default, never a shared device). Personal injury is not
  primarily a DV practice area, but a dog-bite or workplace-assault matter
  can intersect with it, so the defaults are not relaxed.
- Conflict-relevant party questions (at-fault party, insurance carrier,
  co-defendants, property owner/employer, decedent's beneficiaries) come next.
- **Date of injury is the first question asked among case-detail questions**,
  per the card note, so the limitation date can be tracked and double-checked
  as early as possible (ties to `c93`). A separate `date_of_death` question
  exists for wrongful-death matters, since Texas wrongful-death limitations
  run from the date of death, not the date of the underlying injury.
- A health-coverage question (health insurance / Medicaid / Medicare / VA /
  none) opens the lien-tracking workflow.

### Conflict check

At-fault party/defendant, insurance carrier/adjuster, co-defendants, property
owner (premises-liability matters), employer (workplace-injury matters), and
decedent's beneficiaries (wrongful-death matters) are all indexed. The
at-fault party is `adverseByDefault && askAtIntake && blocksClearIfUnnamed`.

### Documents

Folders and checklists track exactly what the card note asks for: medical
providers/records/bills, insurance claims/adjusters/policy limits, demand
letters and offers — plus a dedicated `liens` folder (hospital, health
insurer, Medicare). Starter document templates: a contingency-fee engagement
agreement, a medical-records authorization, a demand letter, a written
settlement statement, and petitions (general personal-injury and
wrongful-death).

### Tasks

Internal task lists cover: tracking medical-records requests, opening
insurance claims and requesting policy limits, preparing and lawyer-reviewing
the demand letter, preparing and lawyer-approving the settlement statement,
and — at the disbursement stage — a lawyer confirming every lien is resolved
before any trust disbursement. Every task tied to a legal rule (`ruleRef`) is
assigned to a lawyer, per the pack's validation contract.

### Billing

Default fee type is **contingency**; `hourly` and `hybrid` are also offered
(a workplace-injury matter can blend a third-party contingency claim with
hourly work on the administrative workers'-compensation side — this is a
judgment call, flagged below for attorney input). The pack reuses the shared
`rules.fee_agreement_terms` gate for fee terms and `rules.trust_accounting`
for trust money, rather than redefining either.

## Rule 1.04(d) compliance approach

Texas Disciplinary Rules of Professional Conduct **Rule 1.04(d)** requires
that a contingency-fee agreement be in writing and state the method of
determining the fee; if the percentage differs by stage (settlement, trial,
or appeal), each stage's percentage must be stated; and the agreement must
state which litigation and other expenses are deducted from the recovery and
whether they are deducted before or after the fee is calculated. Source:
[Texas Disciplinary Rules of Professional Conduct, Rule 1.04](https://www.law.uh.edu/Libraries/ethics/trpc/1.04.html)
(University of Houston Law Center's hosted copy of the rules).

This pack treats that requirement as a `RuleReference` (`contingency_fee_agreement_rule`,
kind `statutory_form`) pointed at the **shared** `rules.fee_agreement_terms`
gate (already listing `c105` among its card IDs in
`src/compliance/gates.ts`) — not a new gate — since the engagement-agreement
template and the written settlement-statement template are both governed by
the same Rule 1.04(d) content and should be reviewed together by the same
attorney sign-off. No percentage, dollar amount, or time period appears
anywhere in the pack; every number is excluded by the pack's own validator
(`validatePack()` rejects any `RuleReference` field whose name matches
`value|days|period|percent|amount|months|years`, and a separate test asserts
the whole pack's stringified text contains no literal day/month/year/percent
number).

The written settlement statement (recovery, fee, expenses, net to client)
required at the end of a contingent matter is modeled as its own document
template (`settlement_statement`, kind `disclosure`), gated on the same
`rules.fee_agreement_terms` key — the content is the direct output of the
Rule 1.04(d) fee-and-expense terms, so splitting it into a second gate seemed
more likely to create a mismatch between the two than to add review
precision. **Open question for Clayton / the reviewing attorney**: confirm
this is the right call, versus a dedicated
`rules.all-engines.personal_injury.settlement_statement` gate.

## Lien-resolution approach

Three liens commonly intersect a Texas personal-injury settlement:

- **Hospital and emergency-medical-services liens** — Texas Property Code
  Chapter 55. Source:
  [Texas Property Code, Chapter 55](https://statutes.capitol.texas.gov/docs/pr/htm/pr.55.htm).
- **Health-insurer subrogation/reimbursement liens** — governed by the
  insurer's plan terms and, for ERISA plans, federal law.
- **Medicare's conditional-payment reimbursement right** under the Medicare
  Secondary Payer statute (42 U.S.C. § 1395y(b)) — Medicare's payments for
  injury-related treatment are "conditional" and must be reimbursed out of a
  settlement, judgment, or award; a firm that disburses settlement funds
  without resolving a known Medicare conditional-payment claim has real,
  documented exposure. See, for example, a DOJ press release describing a law
  firm's settlement of False Claims Act liability for exactly this:
  [DOJ, "Maryland Law Firm... Agrees to Pay United States Nearly $40,000 to Settle"](https://www.justice.gov/usao-md/pr/maryland-law-firm-kandel-associates-pa-agrees-pay-united-states-nearly-40000-settle).

This pack models "liens must be identified and resolved, or otherwise
accounted for, before settlement funds are disbursed from trust" as its own
`RuleReference` (`lien_resolution_before_disbursement`, kind
`eligibility_rule`) behind a **new, pack-specific** gate,
`rules.all-engines.personal_injury.lien_resolution_before_disbursement`,
reviewed by **both an attorney and a CPA** — rather than folding it into the
shared `rules.trust_accounting` gate. Reasoning: `rules.trust_accounting`
already covers the general Texas IOLTA/trust-accounting rules used across
every engine that touches trust money; lien resolution is a
personal-injury-specific precondition on top of that (which liens exist, how
each is verified and negotiated down, and when a lien can be safely treated
as resolved) and benefits from its own, separately trackable sign-off rather
than being buried inside a much broader general-purpose gate. The pack's
own whole-pack content gate (`pack_content`) is likewise reviewed by both an
attorney and a CPA, since it carries this same settlement-flow content.

No dollar thresholds, percentages, or specific timing requirements for any
lien are hard-coded anywhere in the pack — they are gate references only, for
a lawyer/CPA tool, never told to a client.

## What's gated pending attorney/CPA review

- Every client-facing sentence (intake question prompts, safety notice,
  document-request wording, portal stage names) — pending **attorney**
  review, via the per-pack copy gates `gates.ts` auto-generates.
- The limitations-period rule references (`statute_of_limitations`,
  `wrongful_death_accrual`) — shared `rules.limitation_periods` gate (already
  lists `c105`), **attorney** review.
- The contingency-fee/settlement-statement rule reference and the two
  templates it gates — shared `rules.fee_agreement_terms` gate (already
  lists `c105`), **attorney** review.
- The lien-resolution-before-disbursement rule — new
  `rules.all-engines.personal_injury.lien_resolution_before_disbursement`
  gate, **attorney and CPA** review.
- Starter document templates (engagement agreement, medical-records
  authorization, demand letter, petitions) — new
  `rules.all-engines.personal_injury.starter_templates` gate, **attorney**
  review (content and licensing).
- The pack as a whole — new
  `rules.all-engines.personal_injury.pack_content` gate, **attorney and CPA**
  review.

## What's explicitly out of scope

- No database migration — this card adds no new tables.
- `registry.ts` registers `personal_injury` alongside `immigration` (card
  `c104`, merged first); nothing about the Immigration pack itself changes.
- No changes to `src/core/practiceAreas.ts` — `personal_injury` was already a
  valid `PracticeAreaId` with `pilot: false`.

## Open questions for Clayton / reviewers

1. Is reusing `rules.fee_agreement_terms` for both the engagement agreement
   and the settlement-statement template the right call, or should the
   settlement statement get its own dedicated gate?
2. Is a dedicated attorney-and-CPA gate for lien resolution
   (`lien_resolution_before_disbursement`) the right boundary, or should this
   instead be folded into — or more tightly cross-referenced with — the
   shared `rules.trust_accounting` gate?
3. `perMatterType.workplace_injury = "hybrid"` is a judgment call (a
   third-party tort claim is typically contingency; the administrative
   workers'-compensation side is often hourly/flat). Worth confirming with an
   attorney before this becomes the live default for workplace-injury
   matters.
4. `intake.safety.routeTo.emergencyCategory` is set to `"safety_general"` — a
   new category distinct from the Family Law pack's `"safety_dv"` — since
   personal injury is not primarily a DV practice area. Worth confirming this
   matches whatever category taxonomy the safety/emergency flow (`c66`)
   actually expects.
