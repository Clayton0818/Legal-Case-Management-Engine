// c104 — the Immigration pack, as DATA against PracticeAreaPack (./types.ts).
//
// STATUS: DRAFT. Nothing here is legal advice or settled law, and the whole
// pack is pending review by a licensed immigration attorney (gate
// `rules.all-engines.immigration.pack_content`).
//  - Every client-facing sentence is a `draft` behind a copy gate and renders
//    as a visible "[PENDING ATTORNEY REVIEW …]" placeholder until approved.
//  - STRICT NO-ADVICE GUARDRAIL: nowhere in this pack does any client-facing
//    sentence say whether someone qualifies for anything, or which form they
//    should file. Unlicensed immigration "notario" advice is a well-documented
//    source of real harm (missed deadlines, wrong filings, exploitation), and
//    Texas specifically regulates it (Tex. Gov't Code § 406.017, "Representation
//    as Attorney"; Tex. Gov't Code ch. 57 interpreter rules also apply —
//    see docs/product/features/all-engines/c104-immigration-pack.md for full
//    citations). The product only gathers facts and routes to an attorney.
//  - Immigration law is federal (8 CFR; EOIR). A lawyer admitted to practice
//    in any U.S. state, in good standing and recognized by EOIR, may represent
//    clients before USCIS and immigration court regardless of which state's
//    bar they belong to — this pack does not depend on Texas-specific
//    substantive licensing the way the family-law pack does (see c28).
//  - Legal rules (statutory deadlines, eligibility criteria, fee schedules,
//    form/track selection) are RuleReferences only: a gate key and a staff
//    note, NO values. They are lawyer tools, never told to a client as
//    advice; the engine that owns the value calls requireApproval().
//  - Task "dueBusinessDays" are firm workflow suggestions in business days,
//    never legal deadlines.
//  - Card note: asks about immigration court (EOIR) dates and detention very
//    early (right after the core safety screen) because both route to the
//    urgent track (c66). Multilingual by default (c36): every client asked a
//    preferred language and an interpreter flag.

import type { ClientCopy, PracticeAreaPack } from "./types";

const COPY = "copy.all-engines.immigration";
const RULE = "rules.all-engines.immigration";

/** Shared gate keys (src/compliance/gates.ts) used by this pack. Kept as strings so this file stays pure data. */
export const SHARED_RULE_KEYS = {
  limitationPeriods: "rules.limitation_periods",
  feeAgreementTerms: "rules.fee_agreement_terms",
  trustAccounting: "rules.trust_accounting",
} as const;

/** Rule gates this pack defines (see ../gates.ts). */
export const IMMIGRATION_RULE_KEYS = {
  packContent: `${RULE}.pack_content`,
  starterTemplates: `${RULE}.starter_templates`,
  formAndTrackEligibility: `${RULE}.form_and_track_eligibility`,
  uscisNoticeDeadlines: `${RULE}.uscis_notice_deadlines`,
  eoirHearingCalendar: `${RULE}.eoir_hearing_calendar`,
  naturalizationEligibilityTiming: `${RULE}.naturalization_eligibility_timing`,
  removalDefenseReliefEligibility: `${RULE}.removal_defense_relief_eligibility`,
  filingFeeAndWaiverSchedule: `${RULE}.filing_fee_and_waiver_schedule`,
} as const;

function copy(id: string, draft: string): ClientCopy {
  return { copyKey: `${COPY}.${id}`, draft };
}

const BENEFIT_TYPES = ["family_petition", "adjustment_of_status", "citizenship", "work_permit"];
const COURT_TYPES = ["asylum", "removal_defense"];
const ALL = ["*"];

// A few client-facing document requests are worded identically across more
// than one matter type's checklist (same ask, same wording) — the SAME
// ClientCopy object is reused so the draft text can never drift between them.
const IDENTITY_DOCS_REQUEST = copy("doc.identity_docs", "Copies of your current identity and immigration-status documents.");

export const IMMIGRATION_PACK: PracticeAreaPack = {
  id: "immigration",
  version: "0.1.0",
  label: "Immigration",
  jurisdiction: "TX",
  cardId: "c104",
  changelog: ["0.1.0 — first draft for the Immigration pack. Pending licensed-immigration-attorney review."],
  contentReviewGateKey: IMMIGRATION_RULE_KEYS.packContent,

  // -------------------------------------------------------------------------
  // Intake (c12/c13, c66, c36)
  // -------------------------------------------------------------------------
  intake: {
    matterTypes: [
      {
        id: "family_petition",
        label: "Family-based petition",
        description: "A U.S. citizen or permanent-resident relative petitions to bring in or classify a family member (for example, Form I-130).",
        classifierLabels: ["immigration_family_petition"],
        stageTrackId: "immigration_uscis_benefit",
        checklistIds: ["i130_petition_core"],
        openingTaskListIds: ["immigration_opening"],
      },
      {
        id: "adjustment_of_status",
        label: "Adjustment of status (green card)",
        description: "Applying to become a permanent resident while in the United States (Form I-485), often following a family or employment petition.",
        classifierLabels: ["immigration_adjustment_of_status"],
        stageTrackId: "immigration_uscis_benefit",
        checklistIds: ["i485_adjustment_core"],
        openingTaskListIds: ["immigration_opening"],
      },
      {
        id: "citizenship",
        label: "Citizenship and naturalization",
        description: "Applying to become a U.S. citizen (Form N-400).",
        classifierLabels: ["immigration_citizenship"],
        stageTrackId: "immigration_uscis_benefit",
        checklistIds: ["n400_naturalization_core"],
        openingTaskListIds: ["immigration_opening"],
      },
      {
        id: "work_permit",
        label: "Work permit (employment authorization)",
        description: "Applying for permission to work in the United States (Form I-765).",
        classifierLabels: ["immigration_work_permit"],
        stageTrackId: "immigration_uscis_benefit",
        checklistIds: ["i765_work_permit_core"],
        openingTaskListIds: ["immigration_opening"],
      },
      {
        id: "asylum",
        label: "Asylum",
        description: "Seeking protection in the United States because of past harm or fear of future harm abroad (Form I-589), before USCIS or in immigration court.",
        classifierLabels: ["immigration_asylum"],
        stageTrackId: "immigration_court",
        checklistIds: ["i589_asylum_core"],
        openingTaskListIds: ["immigration_opening", "detention_and_court_opening"],
      },
      {
        id: "removal_defense",
        label: "Removal (deportation) defense",
        description: "Defending against removal (deportation) proceedings in immigration court (EOIR).",
        classifierLabels: ["immigration_removal_defense"],
        stageTrackId: "immigration_court",
        checklistIds: ["removal_defense_core"],
        openingTaskListIds: ["immigration_opening", "detention_and_court_opening"],
      },
    ],

    questions: [
      // --- Safety first (c66) ---
      {
        id: "safe_now",
        order: 10,
        group: "safety",
        prompt: copy("q.safe_now", "Before we start: are you safe right now? If you are in danger, please call 911."),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
        safetySignalAnswers: ["no", "unsure"],
        staffNote: "Asked before anything else, exactly as in the other practice-area packs.",
      },
      {
        id: "safe_to_contact",
        order: 11,
        group: "safety",
        prompt: copy("q.safe_to_contact", "Is it safe for us to contact you at the email address and phone number you gave us? Could anyone else read your messages or hear your voicemail?"),
        answerType: "choice",
        choices: ["safe", "not_safe", "unsure"],
        matterTypes: ALL,
        required: true,
        safetySignalAnswers: ["not_safe", "unsure"],
      },
      {
        id: "safe_contact_method",
        order: 12,
        group: "safety",
        prompt: copy("q.safe_contact_method", "Please tell us a safe way to reach you, and any times we should not contact you."),
        answerType: "short_text",
        matterTypes: ALL,
        required: true,
        askWhen: { questionId: "safe_to_contact", answers: ["not_safe", "unsure"] },
      },
      {
        id: "harm_or_persecution_fear",
        order: 13,
        group: "safety",
        prompt: copy("q.harm_or_persecution_fear", "Has anyone hurt you or threatened you, or are you afraid of being harmed if you return to another country? You do not need to explain everything right now."),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
        safetySignalAnswers: ["yes", "unsure"],
        staffNote: "Asylum and removal-defense clients in particular may be fleeing harm; DV-safe handling applies to every matter type, not only family law.",
      },
      // --- Detention and immigration-court dates, asked right after the
      // safety screen and before anything else (card note: route to c66 as
      // urgent) ---
      {
        id: "in_detention",
        order: 14,
        group: "existing_orders",
        prompt: copy("q.in_detention", "Are you, or is the person who needs help, currently being held by immigration authorities (such as ICE) or in a detention facility?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
        urgentSignalAnswers: ["yes", "unsure"],
        staffNote: "Routes to the urgent track (c66) immediately. Staff never tell the client what detention means for their case.",
      },
      {
        id: "detention_location",
        order: 15,
        group: "existing_orders",
        prompt: copy("q.detention_location", "Which facility is holding them, and do you have a booking or case number?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
        askWhen: { questionId: "in_detention", answers: ["yes", "unsure"] },
      },
      {
        id: "upcoming_immigration_court_date",
        order: 16,
        group: "existing_orders",
        prompt: copy("q.upcoming_immigration_court_date", "Do you already have an immigration court hearing date scheduled?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
        urgentSignalAnswers: ["yes", "unsure"],
        staffNote: "Routes to the urgent track (c66). Ties into the EOIR hearing calendar (rules.all-engines.immigration.eoir_hearing_calendar, c91).",
      },
      {
        id: "upcoming_court_date_when",
        order: 17,
        group: "existing_orders",
        prompt: copy("q.upcoming_court_date_when", "When is the hearing, and which immigration court is it at?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
        askWhen: { questionId: "upcoming_immigration_court_date", answers: ["yes", "unsure"] },
      },
      {
        id: "prior_removal_order",
        order: 18,
        group: "existing_orders",
        prompt: copy("q.prior_removal_order", "Has an immigration judge ever ordered removal (deportation), or is there any removal, voluntary-departure, or in-absentia order on file?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
        urgentSignalAnswers: ["yes", "unsure"],
      },
      {
        id: "rfe_received",
        order: 19,
        group: "existing_orders",
        prompt: copy("q.rfe_received", "Have you received a notice from USCIS asking for more evidence or information, with a deadline to respond?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
        urgentSignalAnswers: ["yes", "unsure"],
        staffNote: "Possible response deadline: urgent track; a lawyer reviews it (rules.all-engines.immigration.uscis_notice_deadlines).",
      },
      // --- Parties, before case details (conflict check first) ---
      {
        id: "petitioner_or_sponsor_name",
        order: 20,
        group: "parties",
        prompt: copy("q.petitioner_or_sponsor_name", "If someone else is filing a petition for you, or you are filing one for someone else, what is that person's full name?"),
        answerType: "short_text",
        matterTypes: ["family_petition", "adjustment_of_status"],
        required: true,
        staffNote: "Needed for the conflict check before any case details. An unnamed petitioner/sponsor keeps the check from coming back clear.",
      },
      {
        id: "petitioner_or_sponsor_other_names",
        order: 21,
        group: "parties",
        prompt: copy("q.petitioner_or_sponsor_other_names", "Has that person used any other names?"),
        answerType: "short_text",
        matterTypes: ["family_petition", "adjustment_of_status"],
        required: false,
      },
      {
        id: "family_members_named",
        order: 22,
        group: "parties",
        prompt: copy("q.family_members_named", "Please list any spouse or children who would be included in this case."),
        answerType: "long_text",
        matterTypes: ALL,
        required: false,
      },
      {
        id: "prior_sponsor_or_petitioner_check",
        order: 23,
        group: "parties",
        prompt: copy("q.prior_sponsor_or_petitioner_check", "Has anyone else ever filed an immigration petition for you, or sponsored you, before this one?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: false,
      },
      {
        id: "related_party_in_proceedings",
        order: 24,
        group: "parties",
        prompt: copy("q.related_party_in_proceedings", "Is there anyone else connected to this case whose situation might affect yours — for example, someone named in the same proceedings, or a prior petitioner who is no longer involved?"),
        answerType: "short_text",
        matterTypes: ["asylum", "removal_defense", "family_petition"],
        required: false,
      },
      {
        id: "other_side_lawyer_check",
        order: 25,
        group: "parties",
        prompt: copy("q.other_side_lawyer_check", "Is a government attorney or any other lawyer already involved in this matter? If so, who?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
      },
      // --- Existing USCIS case facts (still before the case narrative) ---
      {
        id: "prior_uscis_filing",
        order: 40,
        group: "existing_orders",
        prompt: copy("q.prior_uscis_filing", "Has any immigration application, petition, or form ever been filed with USCIS for you or by you?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
      },
      {
        id: "prior_filing_details",
        order: 41,
        group: "existing_orders",
        prompt: copy("q.prior_filing_details", "What was filed, and do you know the receipt number or what happened with it?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
        askWhen: { questionId: "prior_uscis_filing", answers: ["yes", "unsure"] },
      },
      {
        id: "existing_receipt_number",
        order: 42,
        group: "existing_orders",
        prompt: copy("q.existing_receipt_number", "If you have a USCIS receipt number for a case that is already pending, what is it?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
      },
      {
        id: "biometrics_or_interview_scheduled",
        order: 43,
        group: "existing_orders",
        prompt: copy("q.biometrics_or_interview_scheduled", "Do you already have a biometrics appointment or an interview scheduled with USCIS?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: false,
      },
      // --- The case ---
      {
        id: "help_wanted",
        order: 50,
        group: "case",
        prompt: copy("q.help_wanted", "In a few sentences, what would you like help with?"),
        answerType: "long_text",
        matterTypes: ALL,
        required: true,
      },
      {
        id: "country_of_origin_and_entry",
        order: 51,
        group: "case",
        prompt: copy("q.country_of_origin_and_entry", "What is your country of birth or citizenship, and how did you last enter the United States, if you know?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: true,
        staffNote: "Facts only. Which forms or track may fit this case is a lawyer decision (rules.all-engines.immigration.form_and_track_eligibility) — never stated to the client.",
      },
      {
        id: "current_immigration_status",
        order: 52,
        group: "case",
        prompt: copy("q.current_immigration_status", "What is your current immigration status, to the best of your knowledge?"),
        answerType: "choice",
        choices: ["citizen", "permanent_resident", "visa_holder", "asylum_seeker", "no_status", "unsure", "other"],
        matterTypes: ALL,
        required: true,
      },
      {
        id: "family_relationship_basis",
        order: 53,
        group: "case",
        prompt: copy("q.family_relationship_basis", "If this is about a family member, what is your relationship to them (for example spouse, parent, or child)?"),
        answerType: "short_text",
        matterTypes: ["family_petition", "adjustment_of_status"],
        required: false,
      },
      {
        id: "employer_sponsor_name",
        order: 54,
        group: "case",
        prompt: copy("q.employer_sponsor_name", "If an employer is involved, what is the employer's name?"),
        answerType: "short_text",
        matterTypes: ["work_permit", "adjustment_of_status"],
        required: false,
      },
      {
        id: "reason_for_fear_summary",
        order: 55,
        group: "case",
        prompt: copy("q.reason_for_fear_summary", "If you are afraid to return to another country, please briefly describe why, in your own words."),
        answerType: "long_text",
        matterTypes: ["asylum"],
        required: true,
        staffNote: "Facts for the attorney only. The product never assesses whether this meets any legal standard for protection.",
      },
      {
        id: "removal_proceedings_stage",
        order: 56,
        group: "case",
        prompt: copy(
          "q.removal_proceedings_stage",
          "Where are you in the immigration court process right now, if you know — for example, have you received a Notice to Appear, are you already in proceedings, or has an order already been issued?"
        ),
        answerType: "choice",
        choices: ["notice_to_appear_received", "in_proceedings", "order_already_issued", "unsure"],
        matterTypes: ["removal_defense"],
        required: true,
      },
      {
        id: "naturalization_basis",
        order: 57,
        group: "case",
        prompt: copy("q.naturalization_basis", "How long have you been a permanent resident, and is this application based on marriage to a U.S. citizen or on another basis?"),
        answerType: "short_text",
        matterTypes: ["citizenship"],
        required: false,
        staffNote: "Facts only; continuous-residence and physical-presence timing is a lawyer worksheet (rules.all-engines.immigration.naturalization_eligibility_timing).",
      },
      // --- Finances ---
      {
        id: "fee_waiver_interest",
        order: 60,
        group: "finances",
        prompt: copy("q.fee_waiver_interest", "Would you like us to look into whether a reduced fee or fee waiver might be available for the government filing fees?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: false,
      },
      {
        id: "ability_to_pay_fees",
        order: 61,
        group: "finances",
        prompt: copy("q.ability_to_pay_fees", "Are you able to pay the government filing fees for this type of case?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: false,
      },
      // --- Logistics: multilingual by default (c36) ---
      {
        id: "preferred_language",
        order: 70,
        group: "logistics",
        prompt: copy("q.preferred_language", "What language do you prefer to use when we talk or write to you?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: true,
      },
      {
        id: "interpreter_needed",
        order: 71,
        group: "logistics",
        prompt: copy("q.interpreter_needed", "Will you need an interpreter for calls or meetings?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
        staffNote: "Sets the interpreter flag read by c36's multilingual handling.",
      },
    ],

    safety: {
      askSafetyFirst: true,
      routeTo: { emergencyCategory: "safety_general", flagType: "intake.emergency" },
      markClientDvSensitive: true,
      safeContactDefaults: {
        requireSafeEmail: true,
        emailAllowed: true,
        smsAllowed: false,
        voicemailAllowed: false,
        sensitiveByEmail: false,
      },
      neverUseSharedDevices: true,
      notice: copy(
        "safety_notice",
        "Your safety comes first. If you are in danger, call 911. This screening gathers information for our team — it is not legal advice, and it does not tell you whether you qualify for anything or which form to file; only a licensed attorney can advise you on that. If someone may be reading your messages or listening to your voicemail, tell us a safer way to reach you before you share details."
      ),
      signalResponse: copy(
        "safety_signal_response",
        "Thank you for telling us. A member of our team has been alerted and will treat this as urgent, and will contact you using the safe method you chose. If you are in danger now, call 911. This message is not legal advice, and we have not made any determination about your case."
      ),
    },
  },

  // -------------------------------------------------------------------------
  // Conflict check: petitioners/sponsors, beneficiaries and other named
  // parties in a petition or proceeding, plus government counsel.
  // -------------------------------------------------------------------------
  conflicts: {
    partyRoles: [
      { id: "client", label: "Client", partyRole: "client", indexRole: "client", relationship: "client", adverseByDefault: false, askAtIntake: false, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ALL },
      { id: "petitioner_or_sponsor", label: "Petitioner or sponsor", partyRole: "related_party", indexRole: "related_party", relationship: "petitioner or sponsor", adverseByDefault: true, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: true, matterTypes: ["family_petition", "adjustment_of_status"] },
      { id: "beneficiary_family_member", label: "Beneficiary or family member named on the petition", partyRole: "related_party", indexRole: "related_party", relationship: "beneficiary or family member", adverseByDefault: false, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ["family_petition", "adjustment_of_status", "asylum"] },
      { id: "prior_sponsor_or_petitioner", label: "Prior sponsor or petitioner in an earlier case", partyRole: "related_party", indexRole: "related_party", relationship: "prior sponsor or petitioner", adverseByDefault: false, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ALL },
      { id: "dhs_ice_counsel", label: "DHS/ICE trial attorney (government counsel)", partyRole: "opposing_counsel", indexRole: "opposing_counsel", relationship: "government counsel", adverseByDefault: true, askAtIntake: false, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ["asylum", "removal_defense"] },
      { id: "co_respondent_or_related_party", label: "Co-respondent or other named party in the same proceedings", partyRole: "co_party", indexRole: "co_party", relationship: "co-respondent", adverseByDefault: true, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ["asylum", "removal_defense", "family_petition"] },
      { id: "other_side_lawyer", label: "Other private lawyer involved", partyRole: "opposing_counsel", indexRole: "opposing_counsel", relationship: "other lawyer", adverseByDefault: true, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ALL },
    ],
  },

  // -------------------------------------------------------------------------
  // Documents: USCIS/EOIR form checklists per matter type, supporting
  // evidence lists, and the lawyer's G-28 (USCIS) / EOIR-28 (immigration
  // court) appearance filed per case.
  // -------------------------------------------------------------------------
  documents: {
    folderTemplate: [
      { id: "engagement", name: "Engagement and intake", defaultPrivilege: "confidential" },
      {
        id: "client_provided",
        name: "From the client",
        defaultPrivilege: "confidential",
        clientVisibleFolder: true,
        children: [
          { id: "client_identity", name: "Identity and status documents", defaultPrivilege: "confidential", clientVisibleFolder: true },
          { id: "client_financial", name: "Financial records", defaultPrivilege: "confidential", clientVisibleFolder: true },
          { id: "client_evidence", name: "Supporting evidence", defaultPrivilege: "confidential", clientVisibleFolder: true },
          { id: "client_prior_filings", name: "Prior filings and notices", defaultPrivilege: "none", clientVisibleFolder: true },
        ],
      },
      { id: "uscis_filings", name: "USCIS filings", defaultPrivilege: "none" },
      { id: "eoir_filings", name: "Immigration court (EOIR) filings", defaultPrivilege: "none" },
      { id: "receipts_notices", name: "Receipts, notices and appointments", defaultPrivilege: "none" },
      { id: "orders_decisions", name: "Decisions and orders", defaultPrivilege: "none" },
      { id: "correspondence", name: "Correspondence", defaultPrivilege: "confidential" },
      { id: "work_product", name: "Attorney notes and work product", defaultPrivilege: "work_product" },
      { id: "billing", name: "Billing", defaultPrivilege: "confidential" },
    ],
    checklists: [
      {
        id: "i130_petition_core",
        label: "Family-based petition (Form I-130)",
        items: [
          { id: "beneficiary_id_docs", label: "Beneficiary identity documents", providedBy: "client", required: true, folderId: "client_identity", clientRequest: copy("doc.beneficiary_id_docs", "Copies of identity documents (such as a passport or birth certificate) for the family member this petition is about.") },
          { id: "petitioner_proof_of_status", label: "Petitioner's proof of status", providedBy: "client", required: true, folderId: "client_identity", clientRequest: copy("doc.petitioner_proof_of_status", "Proof of the petitioner's U.S. citizenship or permanent residence, such as a passport, birth certificate, or green card.") },
          { id: "relationship_evidence", label: "Evidence of the family relationship", providedBy: "client", required: true, folderId: "client_evidence", clientRequest: copy("doc.relationship_evidence", "Evidence of the family relationship, such as a marriage certificate, birth certificates, or photos.") },
          { id: "prior_filings_copies", label: "Copies of any prior filings or notices", providedBy: "client", required: false, folderId: "client_prior_filings", clientRequest: copy("doc.prior_filings_copies", "Copies of any immigration forms or notices already filed or received for this family member.") },
          { id: "supporting_evidence_index", label: "Supporting evidence index (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "work_product", templateId: "supporting_evidence_index" },
          { id: "i130_petition_form", label: "Form I-130, Petition for Alien Relative (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "i130_petition" },
          { id: "g28_filing", label: "Form G-28, Notice of Entry of Appearance (filed by the firm's attorney)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "g28_notice" },
          { id: "receipt_notice", label: "USCIS receipt notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
          { id: "rfe_or_notice", label: "Any Request for Evidence or additional USCIS notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
        ],
      },
      {
        id: "i485_adjustment_core",
        label: "Adjustment of status (Form I-485)",
        items: [
          { id: "identity_docs", label: "Identity and status documents", providedBy: "client", required: true, folderId: "client_identity", clientRequest: IDENTITY_DOCS_REQUEST },
          { id: "immigration_history_docs", label: "Immigration history documents", providedBy: "client", required: true, folderId: "client_prior_filings", clientRequest: copy("doc.immigration_history_docs", "Copies of your Form I-94, prior visas, and any earlier immigration petitions filed for you.") },
          { id: "medical_exam_i693", label: "Medical examination results (Form I-693)", providedBy: "client", required: false, folderId: "client_evidence", clientRequest: copy("doc.medical_exam_i693", "The results of your medical examination (Form I-693), once you have completed it.") },
          { id: "affidavit_of_support_docs", label: "Sponsor's financial documents", providedBy: "client", required: true, folderId: "client_financial", clientRequest: copy("doc.affidavit_of_support_docs", "Financial documents for the person sponsoring you, such as recent tax returns and proof of income.") },
          { id: "supporting_evidence_index", label: "Supporting evidence index (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "work_product", templateId: "supporting_evidence_index" },
          { id: "i485_application_form", label: "Form I-485, Application to Register Permanent Residence or Adjust Status (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "i485_application" },
          { id: "i864_affidavit_form", label: "Form I-864, Affidavit of Support (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "i864_affidavit" },
          { id: "g28_filing", label: "Form G-28, Notice of Entry of Appearance (filed by the firm's attorney)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "g28_notice" },
          { id: "biometrics_notice", label: "Biometrics appointment notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
          { id: "interview_notice", label: "Interview notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
          { id: "rfe_or_notice", label: "Any Request for Evidence or additional USCIS notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
        ],
      },
      {
        id: "n400_naturalization_core",
        label: "Citizenship and naturalization (Form N-400)",
        items: [
          { id: "permanent_resident_card_copy", label: "Permanent resident card copy", providedBy: "client", required: true, folderId: "client_identity", clientRequest: copy("doc.permanent_resident_card_copy", "A copy of your permanent resident card (green card).") },
          { id: "residence_and_travel_history", label: "Residence and travel history", providedBy: "client", required: true, folderId: "client_evidence", clientRequest: copy("doc.residence_and_travel_history", "A list of the addresses where you have lived and the trips you have taken outside the United States, for the period your attorney asks about.") },
          { id: "tax_filing_records", label: "Tax filing records", providedBy: "client", required: false, folderId: "client_financial", clientRequest: copy("doc.tax_filing_records", "Records showing you have filed your taxes, if you have them.") },
          { id: "supporting_evidence_index", label: "Supporting evidence index (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "work_product", templateId: "supporting_evidence_index" },
          { id: "n400_application_form", label: "Form N-400, Application for Naturalization (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "n400_application" },
          { id: "g28_filing", label: "Form G-28, Notice of Entry of Appearance (filed by the firm's attorney)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "g28_notice" },
          { id: "interview_and_civics_notice", label: "Interview and civics-test notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
          { id: "rfe_or_notice", label: "Any Request for Evidence or additional USCIS notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
        ],
      },
      {
        id: "i765_work_permit_core",
        label: "Work permit (Form I-765)",
        items: [
          { id: "identity_and_status_docs", label: "Identity and current status documents", providedBy: "client", required: true, folderId: "client_identity", clientRequest: copy("doc.identity_and_status_docs", "Copies of your current identity and immigration-status documents.") },
          { id: "eligibility_category_evidence", label: "Evidence supporting the application category", providedBy: "client", required: true, folderId: "client_evidence", clientRequest: copy("doc.eligibility_category_evidence", "Evidence showing the basis for this application, such as a receipt notice for a related pending case.") },
          { id: "photos_for_ead", label: "Passport-style photos", providedBy: "client", required: false, folderId: "client_identity", clientRequest: copy("doc.photos_for_ead", "Passport-style photos, if your attorney's office asks for them.") },
          { id: "supporting_evidence_index", label: "Supporting evidence index (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "work_product", templateId: "supporting_evidence_index" },
          { id: "i765_application_form", label: "Form I-765, Application for Employment Authorization (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "i765_application" },
          { id: "g28_filing", label: "Form G-28, Notice of Entry of Appearance (filed by the firm's attorney)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "g28_notice" },
          { id: "ead_receipt_notice", label: "EAD receipt notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
          { id: "rfe_or_notice", label: "Any Request for Evidence or additional USCIS notice", providedBy: "third_party", required: false, folderId: "receipts_notices" },
        ],
      },
      {
        id: "i589_asylum_core",
        label: "Asylum (Form I-589)",
        items: [
          { id: "identity_docs", label: "Identity documents", providedBy: "client", required: true, folderId: "client_identity", clientRequest: IDENTITY_DOCS_REQUEST },
          { id: "evidence_of_harm_or_fear", label: "Evidence related to the claim", providedBy: "client", required: false, folderId: "client_evidence", clientRequest: copy("doc.evidence_of_harm_or_fear", "Any records, photos, messages, or other evidence related to what happened or what you are afraid of, only if it is safe for you to share them.") },
          { id: "country_conditions_support", label: "Country-conditions research (attorney work product)", providedBy: "firm", required: false, folderId: "work_product" },
          { id: "supporting_evidence_index", label: "Supporting evidence index (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "work_product", templateId: "supporting_evidence_index" },
          { id: "i589_application_form", label: "Form I-589, Application for Asylum and for Withholding of Removal (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "uscis_filings", templateId: "i589_application" },
          { id: "g28_filing", label: "Form G-28 (if filed with USCIS, affirmative)", providedBy: "firm", required: false, folderId: "uscis_filings", templateId: "g28_notice" },
          { id: "eoir28_filing", label: "Form EOIR-28 (if the case is or becomes a court matter, defensive)", providedBy: "firm", required: false, folderId: "eoir_filings", templateId: "eoir28_notice" },
          { id: "nta_or_referral_notice", label: "Notice to Appear or asylum-office referral notice, if any", providedBy: "court", required: false, folderId: "eoir_filings" },
          { id: "interview_notice", label: "Asylum interview notice, if affirmative", providedBy: "third_party", required: false, folderId: "receipts_notices" },
        ],
      },
      {
        id: "removal_defense_core",
        label: "Removal (deportation) defense",
        items: [
          { id: "identity_docs", label: "Identity documents", providedBy: "client", required: true, folderId: "client_identity", clientRequest: IDENTITY_DOCS_REQUEST },
          { id: "notice_to_appear_copy", label: "Notice to Appear copy", providedBy: "client", required: false, folderId: "client_prior_filings", clientRequest: copy("doc.notice_to_appear_copy", "A copy of your Notice to Appear, if you have one.") },
          { id: "prior_order_or_filing_copies", label: "Prior court orders, motions, or filings", providedBy: "client", required: false, folderId: "client_prior_filings", clientRequest: copy("doc.prior_order_or_filing_copies", "Copies of any earlier immigration court orders, motions, or filings in your case.") },
          { id: "detention_records", label: "Detention records", providedBy: "client", required: false, folderId: "client_evidence", clientRequest: copy("doc.detention_records", "Your booking number, the facility name, and any custody paperwork, if you are or were detained.") },
          { id: "supporting_evidence_index", label: "Supporting evidence index (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "work_product", templateId: "supporting_evidence_index" },
          { id: "eoir28_filing", label: "Form EOIR-28, Notice of Entry of Appearance (filed by the firm's attorney)", providedBy: "firm", required: true, folderId: "eoir_filings", templateId: "eoir28_notice" },
          { id: "removal_defense_motion_or_brief", label: "Motion, application for relief, or brief (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "eoir_filings", templateId: "removal_defense_filing" },
          { id: "hearing_notice", label: "Hearing notice from the immigration court", providedBy: "court", required: false, folderId: "receipts_notices" },
        ],
      },
    ],
    templates: [
      { id: "i130_petition", label: "Form I-130 petition", kind: "petition", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ["family_petition"] },
      { id: "i485_application", label: "Form I-485 application", kind: "petition", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ["adjustment_of_status"] },
      { id: "i864_affidavit", label: "Form I-864 affidavit of support", kind: "disclosure", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ["adjustment_of_status"] },
      { id: "n400_application", label: "Form N-400 application", kind: "petition", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ["citizenship"] },
      { id: "i765_application", label: "Form I-765 application", kind: "petition", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ["work_permit", "adjustment_of_status", "asylum"] },
      { id: "i589_application", label: "Form I-589 application", kind: "petition", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ["asylum"] },
      { id: "g28_notice", label: "Form G-28 notice of entry of appearance (USCIS)", kind: "letter", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ALL },
      { id: "eoir28_notice", label: "Form EOIR-28 notice of entry of appearance (immigration court)", kind: "letter", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ["asylum", "removal_defense"] },
      { id: "removal_defense_filing", label: "Removal-defense motion, application for relief, or brief", kind: "petition", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ["removal_defense"] },
      { id: "supporting_evidence_index", label: "Supporting evidence index", kind: "worksheet", gateKey: IMMIGRATION_RULE_KEYS.starterTemplates, matterTypes: ALL },
    ],
  },

  // -------------------------------------------------------------------------
  // Task lists — workflow suggestions, internal, business days
  // -------------------------------------------------------------------------
  tasks: {
    lists: [
      {
        id: "immigration_opening",
        label: "Every new immigration matter",
        trigger: { on: "matter_opened" },
        matterTypes: ALL,
        tasks: [
          { id: "confirm_safe_contact", title: "Confirm the client's safe-contact settings before any outbound message", assigneeRole: "intake_staff", dueBusinessDays: 1, kind: "all-engines.immigration.confirm_safe_contact", visibility: "internal" },
          { id: "confirm_language_and_interpreter", title: "Confirm preferred language and whether an interpreter is needed for every call and meeting", assigneeRole: "intake_staff", dueBusinessDays: 1, kind: "all-engines.immigration.confirm_language_and_interpreter", visibility: "internal" },
          { id: "confirm_parties_and_conflicts", title: "Check every named party (petitioner/sponsor, beneficiary, related parties) is on the matter and in the conflict index", assigneeRole: "paralegal", dueBusinessDays: 1, kind: "all-engines.immigration.confirm_parties_and_conflicts", visibility: "internal" },
          { id: "lawyer_reviews_urgent_signals", title: "Lawyer reviews any detention or immigration-court date the client reported", assigneeRole: "lawyer", dueBusinessDays: 0, kind: "all-engines.immigration.lawyer_reviews_urgent_signals", ruleRef: "eoir_hearing_calendar", visibility: "internal" },
          { id: "form_track_review", title: "Lawyer reviews intake facts against candidate forms and process tracks (never shared with the client as a determination)", assigneeRole: "lawyer", dueBusinessDays: 2, kind: "all-engines.immigration.form_track_review", ruleRef: "form_and_track_eligibility", visibility: "internal" },
          { id: "send_checklist", title: "Send the document checklist through the portal", assigneeRole: "paralegal", dueBusinessDays: 2, kind: "all-engines.immigration.send_checklist", visibility: "internal" },
          { id: "retainer_or_flat_fee_setup", title: "Check the flat-fee agreement and pay schedule are in place", assigneeRole: "bookkeeper", dueBusinessDays: 2, kind: "all-engines.immigration.retainer_or_flat_fee_setup", visibility: "internal" },
        ],
      },
      {
        id: "detention_and_court_opening",
        label: "Asylum / removal defense: first steps",
        trigger: { on: "matter_opened" },
        matterTypes: COURT_TYPES,
        tasks: [
          { id: "confirm_detention_status", title: "Confirm current detention status and custody contact details", assigneeRole: "paralegal", dueBusinessDays: 0, kind: "all-engines.immigration.confirm_detention_status", visibility: "internal" },
          { id: "file_appearance", title: "File the attorney's appearance (G-28 or EOIR-28, whichever applies) for this case", assigneeRole: "paralegal", dueBusinessDays: 1, kind: "all-engines.immigration.file_appearance", visibility: "internal" },
          { id: "asylum_deadline_review", title: "Lawyer reviews whether a statutory asylum-filing deadline applies and whether an exception may be relevant", assigneeRole: "lawyer", dueBusinessDays: 1, kind: "all-engines.immigration.asylum_deadline_review", ruleRef: "asylum_filing_deadline", visibility: "internal" },
        ],
      },
      {
        id: "preparing_filing",
        label: "Preparing to file",
        trigger: { on: "stage_entered", stageId: "case_preparation" },
        matterTypes: ALL,
        tasks: [
          { id: "draft_forms_or_motion", title: "Draft the forms or motion from the reviewed template", assigneeRole: "paralegal", dueBusinessDays: 5, kind: "all-engines.immigration.draft_forms_or_motion", visibility: "internal" },
          { id: "evidence_index_prepared", title: "Prepare the supporting evidence index from client records", assigneeRole: "paralegal", dueBusinessDays: 5, kind: "all-engines.immigration.evidence_index_prepared", visibility: "internal" },
          { id: "lawyer_reviews_filing", title: "Lawyer reviews and approves the filing before it goes out", assigneeRole: "lawyer", dueBusinessDays: 7, kind: "all-engines.immigration.lawyer_reviews_filing", visibility: "internal" },
          { id: "fee_and_waiver_check", title: "Lawyer confirms the filing-fee amount and any fee-waiver eligibility against current USCIS/EOIR fee rules", assigneeRole: "lawyer", dueBusinessDays: 3, kind: "all-engines.immigration.fee_and_waiver_check", ruleRef: "filing_fee_and_waiver_schedule", visibility: "internal" },
        ],
      },
      {
        id: "filed_with_uscis_tasks",
        label: "Filed with USCIS",
        trigger: { on: "stage_entered", stageId: "filed_with_uscis" },
        matterTypes: BENEFIT_TYPES,
        tasks: [
          { id: "track_receipt_number", title: "Log the USCIS receipt number on the matter", assigneeRole: "paralegal", dueBusinessDays: 1, kind: "all-engines.immigration.track_receipt_number", visibility: "internal" },
          { id: "monitor_case_status", title: "Monitor USCIS case status for updates", assigneeRole: "paralegal", kind: "all-engines.immigration.monitor_case_status", visibility: "internal" },
        ],
      },
      {
        id: "filed_with_court_tasks",
        label: "Filed with the immigration court",
        trigger: { on: "stage_entered", stageId: "filed_with_court" },
        matterTypes: COURT_TYPES,
        tasks: [
          { id: "track_court_filing", title: "Log the immigration-court filing and case number on the matter", assigneeRole: "paralegal", dueBusinessDays: 1, kind: "all-engines.immigration.track_court_filing", visibility: "internal" },
          { id: "confirm_appearance_on_file", title: "Confirm the EOIR-28 appearance is on file with the court", assigneeRole: "paralegal", dueBusinessDays: 1, kind: "all-engines.immigration.confirm_appearance_on_file", visibility: "internal" },
        ],
      },
      {
        id: "rfe_or_biometrics_tasks",
        label: "USCIS requests and appointments",
        trigger: { on: "stage_entered", stageId: "rfe_or_biometrics" },
        matterTypes: BENEFIT_TYPES,
        tasks: [
          { id: "track_rfe_deadline", title: "Lawyer confirms the Request for Evidence response deadline against the real clock", assigneeRole: "lawyer", dueBusinessDays: 1, kind: "all-engines.immigration.track_rfe_deadline", ruleRef: "uscis_notice_deadlines", visibility: "internal" },
          { id: "schedule_biometrics_or_interview", title: "Confirm the biometrics or interview appointment and client logistics (interpreter, travel)", assigneeRole: "paralegal", dueBusinessDays: 2, kind: "all-engines.immigration.schedule_biometrics_or_interview", visibility: "internal" },
        ],
      },
      {
        id: "master_calendar_tasks",
        label: "Immigration-court hearings",
        trigger: { on: "stage_entered", stageId: "master_calendar_hearings" },
        matterTypes: COURT_TYPES,
        tasks: [
          { id: "track_hearing_dates", title: "Lawyer confirms every EOIR hearing date against the matter calendar (c91)", assigneeRole: "lawyer", dueBusinessDays: 1, kind: "all-engines.immigration.track_hearing_dates", ruleRef: "eoir_hearing_calendar", visibility: "internal" },
          { id: "prepare_master_calendar_filing", title: "Prepare any filing due before the next master calendar hearing", assigneeRole: "paralegal", dueBusinessDays: 3, kind: "all-engines.immigration.prepare_master_calendar_filing", visibility: "internal" },
        ],
      },
      {
        id: "merits_hearing_tasks",
        label: "Preparing for the merits hearing",
        trigger: { on: "stage_entered", stageId: "merits_hearing_prep" },
        matterTypes: COURT_TYPES,
        tasks: [
          { id: "prepare_merits_hearing", title: "Lawyer prepares the merits-hearing case theory and filings", assigneeRole: "lawyer", dueBusinessDays: 10, kind: "all-engines.immigration.prepare_merits_hearing", visibility: "internal" },
          { id: "witness_and_evidence_prep", title: "Prepare witnesses and finalize the evidence index for the hearing", assigneeRole: "paralegal", dueBusinessDays: 10, kind: "all-engines.immigration.witness_and_evidence_prep", visibility: "internal" },
          { id: "relief_eligibility_review", title: "Lawyer reviews which forms of relief from removal may be available on these facts", assigneeRole: "lawyer", dueBusinessDays: 10, kind: "all-engines.immigration.relief_eligibility_review", ruleRef: "removal_defense_relief_eligibility", visibility: "internal" },
        ],
      },
      {
        id: "decision_tasks",
        label: "Decision received",
        trigger: { on: "stage_entered", stageId: "decision_received" },
        matterTypes: ALL,
        tasks: [
          { id: "review_decision", title: "Lawyer reviews the decision with the client", assigneeRole: "lawyer", dueBusinessDays: 2, kind: "all-engines.immigration.review_decision", visibility: "internal" },
          { id: "plan_next_steps", title: "Lawyer plans next filings or appeal options, if any", assigneeRole: "lawyer", dueBusinessDays: 3, kind: "all-engines.immigration.plan_next_steps", ruleRef: "form_and_track_eligibility", visibility: "internal" },
        ],
      },
      {
        id: "post_decision_tasks",
        label: "After the decision",
        trigger: { on: "stage_entered", stageId: "post_decision" },
        matterTypes: ALL,
        tasks: [{ id: "close_out_or_next_steps", title: "Close out the matter or open the next matter for follow-on relief", assigneeRole: "paralegal", dueBusinessDays: 5, kind: "all-engines.immigration.close_out_or_next_steps", visibility: "internal" }],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Stages
  // -------------------------------------------------------------------------
  stages: {
    tracks: [
      {
        id: "immigration_uscis_benefit",
        label: "USCIS benefit case",
        stages: [
          { id: "consultation", label: "Consultation", systemStage: "prospective", clientLabel: copy("stage.consultation", "Consultation") },
          { id: "retained", label: "Retained", systemStage: "retained", clientLabel: copy("stage.retained", "Getting started") },
          { id: "case_preparation", label: "Preparing the case", clientLabel: copy("stage.case_preparation", "Preparing your case") },
          { id: "filed_with_uscis", label: "Filed with USCIS", clientLabel: copy("stage.filed_with_uscis", "Filed with USCIS") },
          { id: "rfe_or_biometrics", label: "Responding to USCIS requests", clientLabel: copy("stage.rfe_or_biometrics", "Responding to USCIS requests") },
          { id: "interview_or_review", label: "Interview or review", clientLabel: copy("stage.interview_or_review", "Interview or review") },
          { id: "decision_received", label: "Decision received", clientLabel: copy("stage.decision_received", "Decision received") },
          { id: "post_decision", label: "After the decision", clientLabel: copy("stage.post_decision", "After your decision") },
          { id: "closed", label: "Closed", systemStage: "closed", clientLabel: copy("stage.closed", "Closed") },
        ],
      },
      {
        id: "immigration_court",
        label: "Immigration court case",
        stages: [
          { id: "consultation", label: "Consultation", systemStage: "prospective", clientLabel: copy("stage.consultation", "Consultation") },
          { id: "retained", label: "Retained", systemStage: "retained", clientLabel: copy("stage.retained", "Getting started") },
          { id: "case_preparation", label: "Preparing the case", clientLabel: copy("stage.case_preparation", "Preparing your case") },
          { id: "filed_with_court", label: "Filed with the immigration court", clientLabel: copy("stage.filed_with_court", "Filed with the immigration court") },
          { id: "master_calendar_hearings", label: "Master calendar hearings", clientLabel: copy("stage.master_calendar_hearings", "Immigration court hearings") },
          { id: "merits_hearing_prep", label: "Preparing for the merits hearing", clientLabel: copy("stage.merits_hearing_prep", "Preparing for your hearing") },
          { id: "decision_received", label: "Decision received", clientLabel: copy("stage.decision_received", "Decision received") },
          { id: "post_decision", label: "After the decision", clientLabel: copy("stage.post_decision", "After your decision") },
          { id: "closed", label: "Closed", systemStage: "closed", clientLabel: copy("stage.closed", "Closed") },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Deadlines and immigration rules — REFERENCES ONLY, lawyer tools.
  // -------------------------------------------------------------------------
  deadlines: {
    rules: [
      {
        id: "form_and_track_eligibility",
        label: "Which immigration forms or process track may fit this case (lawyer tool)",
        kind: "eligibility_rule",
        gateKey: IMMIGRATION_RULE_KEYS.formAndTrackEligibility,
        ownerEngine: "intake",
        matterTypes: ALL,
        audience: "lawyer_tool",
        note: "Flags, for the attorney only, candidate forms or process tracks suggested by the intake facts gathered (for example I-130 vs. I-485 vs. I-589). The product never tells the client which form to file or whether they qualify for anything — this exists specifically because of the documented harm of unauthorized ('notario') immigration practice and Texas's own rules against it.",
      },
      {
        id: "uscis_notice_deadlines",
        label: "USCIS Request for Evidence, biometrics and interview timing",
        kind: "court_deadline",
        gateKey: IMMIGRATION_RULE_KEYS.uscisNoticeDeadlines,
        ownerEngine: "calendar-core",
        matterTypes: ALL,
        audience: "lawyer_tool",
        note: "Response and appearance timing read off USCIS notices; proposed to the lawyer for confirmation and tied into the matter calendar (c91). The pack holds no deadline value.",
      },
      {
        id: "eoir_hearing_calendar",
        label: "Immigration court (EOIR) hearing calendar",
        kind: "court_deadline",
        gateKey: IMMIGRATION_RULE_KEYS.eoirHearingCalendar,
        ownerEngine: "calendar-core",
        matterTypes: COURT_TYPES,
        audience: "lawyer_tool",
        note: "Master calendar and merits hearing dates proposed to the matter calendar (c91) for a lawyer to confirm. The pack holds no timing value.",
      },
      {
        id: "asylum_filing_deadline",
        label: "Statutory asylum-filing deadline and exceptions",
        kind: "limitation_period",
        gateKey: SHARED_RULE_KEYS.limitationPeriods,
        ownerEngine: "calendar-core",
        matterTypes: ["asylum"],
        audience: "lawyer_tool",
        note: "Flags, for the lawyer, that a statutory filing deadline and its exceptions apply to asylum applications and must be checked against the real clock. The pack holds no deadline value; the product never tells a client whether an exception applies.",
      },
      {
        id: "naturalization_eligibility_timing",
        label: "Naturalization continuous-residence and physical-presence timing",
        kind: "eligibility_rule",
        gateKey: IMMIGRATION_RULE_KEYS.naturalizationEligibilityTiming,
        ownerEngine: "intake",
        matterTypes: ["citizenship"],
        audience: "lawyer_tool",
        note: "Lawyer worksheet only. Continuous-residence and physical-presence rules vary by basis and change by law; never shown to a client as a determination of readiness to apply.",
      },
      {
        id: "removal_defense_relief_eligibility",
        label: "Available forms of relief from removal",
        kind: "eligibility_rule",
        gateKey: IMMIGRATION_RULE_KEYS.removalDefenseReliefEligibility,
        ownerEngine: "intake",
        matterTypes: ["removal_defense", "asylum"],
        audience: "lawyer_tool",
        note: "Prompts the lawyer with the attorney-reviewed relief options and screening questions; the product never decides whether any form of relief applies.",
      },
      {
        id: "filing_fee_and_waiver_schedule",
        label: "USCIS/EOIR filing-fee schedule and fee-waiver criteria",
        kind: "guideline_calculator",
        gateKey: IMMIGRATION_RULE_KEYS.filingFeeAndWaiverSchedule,
        ownerEngine: "billing-trust",
        matterTypes: ALL,
        audience: "lawyer_tool",
        note: "Current government filing fees and fee-waiver criteria change on their own schedule; the pack holds no fee amount. Proposed to staff for confirmation before any invoice or fee quote.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Billing (c52) — usually flat fee with a pay schedule; trust c75
  // -------------------------------------------------------------------------
  billing: {
    defaultFeeType: "flat_fee",
    offeredFeeTypes: ["flat_fee", "hourly", "retainer_hourly"],
    withheldFeeTypes: [
      {
        feeType: "contingency",
        gateKey: SHARED_RULE_KEYS.feeAgreementTerms,
        why: "There is no monetary recovery in an immigration case, and contingent fees for this kind of representation raise professional-conduct questions; not offered unless an attorney's review says otherwise.",
      },
    ],
    retainerFloorFromFirmSettings: true,
    feeTermsGateKey: SHARED_RULE_KEYS.feeAgreementTerms,
    trustGateKey: SHARED_RULE_KEYS.trustAccounting,
    perMatterType: {
      family_petition: "flat_fee",
      adjustment_of_status: "flat_fee",
      citizenship: "flat_fee",
      work_permit: "flat_fee",
      asylum: "hourly",
      removal_defense: "hourly",
    },
  },
};
