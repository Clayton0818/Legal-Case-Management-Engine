# c104 — Immigration pack

**Code:** `src/engines/all-engines/packs/immigration.ts` (data), gates in `src/engines/all-engines/gates.ts`. **Status: DRAFT, version 0.1.0.** Needs review by a licensed immigration attorney before it is relied on (`rules.all-engines.immigration.pack_content`). Nothing in it is legal advice.

## Scope
Matter types: family-based petition (I-130), adjustment of status / green card (I-485), citizenship and naturalization (N-400), work permit / employment authorization (I-765), asylum (I-589), and removal (deportation) defense before the immigration court (EOIR). Mapped to the classifier's `immigration_*` labels.

## What it contains
- **Intake questions (26):** safety first (are you safe; is it safe to contact you; harm or threatened), then — per the card note — detention and immigration-court-date screening right after (both route to the urgent track, c66, before anything else), then parties by name before any case detail (petitioner/sponsor, beneficiary, related parties, government counsel, other lawyer), then remaining USCIS case facts, then the case narrative, finances, and — multilingual by default (c36) — preferred language and an interpreter flag on every matter.
- **Safety / DV:** the same conservative defaults as the Family Law pack (DV-sensitive contact, no SMS, no voicemail, never a shared device) apply uniformly, since asylum and removal-defense clients in particular may be fleeing harm.
- **Conflict roles:** client, petitioner/sponsor, beneficiary/family member, prior sponsor/petitioner, DHS/ICE trial attorney (government counsel), co-respondent/related party, other private lawyer. An unnamed petitioner/sponsor keeps the check from coming back clear.
- **Documents:** folder template (client identity/financial/evidence/prior-filings, USCIS filings, EOIR filings, receipts & notices, decisions, work product, billing); checklists per matter type for I-130, I-485 (+ I-864 affidavit of support), N-400, I-765, I-589, and removal defense; a shared supporting-evidence-index template per matter type; the firm's **Form G-28** (USCIS) and **Form EOIR-28** (immigration court) appearance filed per case — these are two different forms for two different fora, both modeled.
- **Stages:** two tracks — a USCIS benefit track (consultation → retained → preparing the case → filed with USCIS → responding to USCIS requests → interview/review → decision → after the decision → closed) and an immigration-court track (… → filed with the court → master calendar hearings → preparing for the merits hearing → decision → after the decision → closed).
- **Task lists:** opening tasks (safe contact, language/interpreter, parties/conflicts, lawyer reviews any detention or court date reported, form/track review, checklist, flat-fee setup), a detention/court-specific opening list for asylum and removal defense, and per-stage tasks (filing prep, USCIS receipt/RFE/biometrics tracking, EOIR hearing-date tracking, merits-hearing prep, decision and post-decision). Any task that touches a legal rule is a lawyer task pointing at a rule reference.
- **Billing:** flat fee by default with a pay schedule (c52); hourly and a retainer+hourly option also offered; contingency withheld (no monetary recovery in an immigration case); trust movements behind `rules.trust_accounting`.

## The no-advice / "notario" guardrail
Unlicensed immigration assistance — commonly called "notario" practice, because in much of Latin America a *notario público* is a trained legal official, which the English "notary public" is not — is a well-documented source of real harm: missed statutory deadlines, wrong or mismatched form choices, and outright exploitation of vulnerable clients. **Texas Government Code § 406.017 ("Representation as Attorney")** specifically restricts non-attorneys from representing they can act as, or perform services reserved to, an attorney, and the Texas Attorney General has repeatedly brought enforcement actions against fraudulent "notario" and unauthorized immigration-consultant operations. Because of this, every client-facing sentence in this pack is written so that **the product never says whether someone qualifies for any immigration benefit, and never says which form to file** — it only gathers facts and routes them to a licensed attorney. The one place the pack *does* name "qualify" and "which form to file" is the safety/intake notice itself, which explicitly **disclaims** making either determination. A corresponding staff-only `eligibility_rule` (`rules.all-engines.immigration.form_and_track_eligibility`) exists so the lawyer — not the AI — reviews which forms or process track the facts suggest; it is `audience: "lawyer_tool"` and is never shown to a client.

## Immigration is federal law (c28 launch-state logic)
Immigration practice is governed by federal law (8 CFR) and adjudicated by USCIS and the Executive Office for Immigration Review (EOIR), not by state courts. A lawyer admitted to practice in any U.S. state, in good standing, may represent clients before USCIS and before EOIR regardless of which state's bar they belong to (EOIR's own guidance on who may represent a person in immigration court confirms this). That means this pack does **not** depend on Texas-specific substantive licensing the way the Family Law pack does — relevant to `c28`'s launch-state logic, since a firm's lawyers need not be licensed in the client's state to take an immigration matter.

## Immigration rules: references only (lawyer tools, never client advice)
| Reference | Gate |
|---|---|
| Which forms/process track may fit this case | `rules.all-engines.immigration.form_and_track_eligibility` |
| USCIS Request for Evidence, biometrics and interview timing | `rules.all-engines.immigration.uscis_notice_deadlines` |
| Immigration court (EOIR) hearing calendar | `rules.all-engines.immigration.eoir_hearing_calendar` |
| Statutory asylum-filing deadline and exceptions | `rules.limitation_periods` (shared) |
| Naturalization continuous-residence / physical-presence timing | `rules.all-engines.immigration.naturalization_eligibility_timing` |
| Available forms of relief from removal | `rules.all-engines.immigration.removal_defense_relief_eligibility` |
| USCIS/EOIR filing-fee schedule and fee-waiver criteria | `rules.all-engines.immigration.filing_fee_and_waiver_schedule` |

The pack holds **no** periods, percentages, fee amounts or form text (a test fails if any "N days/months/years" appears). The engine that owns each tool must call `requireApproval(gateKey)` and keep the values in its own gated config; results are proposed to a lawyer, never told to a client.

## Sources
- [USCIS Form I-130, Petition for Alien Relative](https://www.uscis.gov/i-130)
- [USCIS Form I-485, Application to Register Permanent Residence or Adjust Status](https://www.uscis.gov/i-485)
- [USCIS Form I-765, Application for Employment Authorization](https://www.uscis.gov/i-765)
- [USCIS Form N-400, Application for Naturalization](https://www.uscis.gov/n-400)
- [USCIS Form I-589, Application for Asylum and for Withholding of Removal](https://www.uscis.gov/i-589)
- [USCIS Form I-864, Affidavit of Support Under Section 213A of the INA](https://www.uscis.gov/i-864)
- [USCIS Form G-28, Notice of Entry of Appearance as Attorney or Accredited Representative](https://www.uscis.gov/g-28)
- [EOIR — "Can Someone Represent You?"](https://www.justice.gov/eoir/can-someone-represent-you-eoir) — who may appear before the immigration court, including that an attorney in good standing in any U.S. state jurisdiction qualifies
- [EOIR, Executive Office for Immigration Review — agency overview](https://www.justice.gov/eoir) — Notice to Appear, master calendar and merits hearings, EOIR Form 28
- [Tex. Gov't Code § 406.017, "Representation as Attorney"](https://texas.public.law/statutes/tex._gov't_code_section_406.017)
- Texas Attorney General press releases on enforcement against fraudulent "notario" / unauthorized immigration-consultant operations (texasattorneygeneral.gov)

## For the attorney reviewer
Approve per gate with `npm run compliance -- approve --gate <key> --reviewer attorney --by "<name>"`. Specific questions:
1. Is the question order right (safety → detention/court date → parties → case) and is anything missing before engagement?
2. Is withholding contingency fees in immigration matters the right product default?
3. Should the one-affirmative-asylum-interview-notice checklist item be split out as its own checklist rather than living inside the I-589 checklist?
4. Wording of the safety notice, the urgent-signal response, and every document request — in particular, confirm nothing reads as advice about eligibility or form choice.
5. Whether `g28_notice`/`eoir28_notice` should instead be modeled as a single unified "entry of appearance" template with per-forum variants, rather than two template ids.

---

*A licensed attorney must review this pack's content, wording and rule references before any client sees them or any lawyer relies on them. Immigration-specific UPL risk (unauthorized practice / notario fraud) makes this review especially important.*
