// c105 — the Personal Injury pack (Texas), as DATA against PracticeAreaPack
// (./types.ts). Follows the Family Law pack (c103, ./family.ts) pattern.
//
// STATUS: DRAFT. Nothing here is legal advice or settled Texas law, and the
// whole pack is pending review by a licensed Texas personal-injury attorney
// AND a CPA (gate `rules.all-engines.personal_injury.pack_content`) —
// the settlement-statement, fee-split, and lien/trust-disbursement content
// in particular needs both a lawyer's and an accountant's sign-off before any
// client sees it or any lawyer relies on it.
//  - Every client-facing sentence is a `draft` behind a copy gate and renders
//    as a visible "[PENDING ATTORNEY REVIEW …]" placeholder until approved.
//  - Texas-specific legal rules (the personal-injury/wrongful-death
//    limitations period and its exceptions, the Rule 1.04(d) contingency-fee
//    and settlement-statement requirements, and the lien-resolution-before-
//    disbursement rule) are RuleReferences only: a gate key and a staff note,
//    NO values. They are lawyer tools, never told to a client as advice; the
//    engine that owns the value calls requireApproval().
//  - Task "dueBusinessDays" are firm workflow suggestions in business days,
//    never legal deadlines.
//  - Safety first, same as every other pack: safety questions are asked
//    before any case detail, any concerning answer routes to the emergency
//    flow and marks the client contact DV-sensitive, and client contact
//    defaults are the most conservative ones (no SMS/voicemail by default).
//    Personal injury is not primarily a DV practice area, but a dog-bite or
//    workplace-assault matter can intersect with it, so the same conservative
//    defaults apply uniformly.

import type { ClientCopy, PracticeAreaPack } from "./types";

const COPY = "copy.all-engines.personal_injury";
const RULE = "rules.all-engines.personal_injury";

/** Shared gate keys (src/compliance/gates.ts) used by this pack. Kept as strings so this file stays pure data. */
export const SHARED_RULE_KEYS = {
  limitationPeriods: "rules.limitation_periods",
  feeAgreementTerms: "rules.fee_agreement_terms",
  trustAccounting: "rules.trust_accounting",
} as const;

/** Rule gates this pack defines itself (see ../gates.ts). */
export const PERSONAL_INJURY_RULE_KEYS = {
  packContent: `${RULE}.pack_content`,
  starterTemplates: `${RULE}.starter_templates`,
  lienResolutionBeforeDisbursement: `${RULE}.lien_resolution_before_disbursement`,
} as const;

function copy(id: string, draft: string): ClientCopy {
  return { copyKey: `${COPY}.${id}`, draft };
}

const PREMISES_TYPES = ["slip_and_fall", "dog_bite"];
const ALL = ["*"];

export const PERSONAL_INJURY_PACK: PracticeAreaPack = {
  id: "personal_injury",
  version: "0.1.0",
  label: "Personal Injury",
  jurisdiction: "TX",
  cardId: "c105",
  changelog: ["0.1.0 — first draft. Pending Texas personal-injury attorney and CPA review, especially the settlement-statement and lien-resolution content."],
  contentReviewGateKey: PERSONAL_INJURY_RULE_KEYS.packContent,

  // -------------------------------------------------------------------------
  // Intake — date of injury first among case questions, after safety and the
  // conflict-relevant party questions (c93, c66).
  // -------------------------------------------------------------------------
  intake: {
    matterTypes: [
      {
        id: "car_truck_crash",
        label: "Car and truck crash",
        description: "A collision involving a car, truck, or motorcycle.",
        classifierLabels: ["personal_injury_car_truck_crash"],
        stageTrackId: "personal_injury_case",
        checklistIds: ["pi_core"],
        openingTaskListIds: ["pi_opening"],
      },
      {
        id: "slip_and_fall",
        label: "Slip and fall",
        description: "A fall on someone else's property, such as a store, sidewalk, or rental property.",
        classifierLabels: ["personal_injury_slip_and_fall"],
        stageTrackId: "personal_injury_case",
        checklistIds: ["pi_core", "premises_liability_core"],
        openingTaskListIds: ["pi_opening"],
      },
      {
        id: "dog_bite",
        label: "Dog bite",
        description: "An injury caused by a dog or other animal.",
        classifierLabels: ["personal_injury_dog_bite"],
        stageTrackId: "personal_injury_case",
        checklistIds: ["pi_core", "premises_liability_core"],
        openingTaskListIds: ["pi_opening"],
      },
      {
        id: "workplace_injury",
        label: "Workplace injury",
        description: "An injury that happened at work, including a possible third-party claim alongside any workers'-compensation claim.",
        classifierLabels: ["personal_injury_workplace_injury"],
        stageTrackId: "personal_injury_case",
        checklistIds: ["pi_core", "workplace_injury_core"],
        openingTaskListIds: ["pi_opening"],
      },
      {
        id: "wrongful_death",
        label: "Wrongful death",
        description: "A death caused by someone else's conduct; brought by the decedent's beneficiaries or estate.",
        classifierLabels: ["personal_injury_wrongful_death"],
        stageTrackId: "personal_injury_case",
        checklistIds: ["pi_core", "wrongful_death_core"],
        openingTaskListIds: ["pi_opening", "wrongful_death_opening"],
      },
    ],

    questions: [
      // --- Safety first ---
      {
        id: "safe_now",
        order: 10,
        group: "safety",
        prompt: copy("q.safe_now", "Before we start: are you safe right now? If you are in danger, please call 911."),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: true,
        safetySignalAnswers: ["no", "unsure"],
        staffNote: "Asked before anything else, the same as every other practice area. 'No' or 'unsure' routes to the emergency flow immediately — relevant to, for example, a dog-bite or workplace-assault matter.",
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
        staffNote: "Any answer other than 'safe' marks the contact DV-sensitive and requires a safe contact method.",
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
        staffNote: "Stored only in parties.safe_contact (never in free-text notes).",
      },
      // --- Parties, before case details (conflict check first) ---
      {
        id: "at_fault_party_name",
        order: 20,
        group: "parties",
        prompt: copy("q.at_fault_party_name", "What is the name of the person, driver, or business you believe caused your injury, if you know it?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: true,
        staffNote: "Needed for the conflict check before any case details. An unnamed at-fault party keeps the check from coming back clear.",
      },
      {
        id: "at_fault_party_other_names",
        order: 21,
        group: "parties",
        prompt: copy("q.at_fault_party_other_names", "Has that person or business gone by any other name?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
      },
      {
        id: "at_fault_insurance_company",
        order: 22,
        group: "parties",
        prompt: copy("q.at_fault_insurance_company", "If you know it, what is the name of the insurance company for the person or business you believe is responsible?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
        staffNote: "Feeds the insurance-claims and policy-limits tracking checklist.",
      },
      {
        id: "property_or_employer_name",
        order: 23,
        group: "parties",
        prompt: copy("q.property_or_employer_name", "What is the name of the property, business, or employer where this happened?"),
        answerType: "short_text",
        matterTypes: PREMISES_TYPES.concat("workplace_injury"),
        required: false,
      },
      {
        id: "co_defendants",
        order: 24,
        group: "parties",
        prompt: copy("q.co_defendants", "Is there more than one person or company that may be responsible for what happened?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
      },
      {
        id: "other_side_lawyer",
        order: 25,
        group: "parties",
        prompt: copy("q.other_side_lawyer", "Does the other side already have a lawyer? If so, who?"),
        answerType: "short_text",
        matterTypes: ALL,
        required: false,
      },
      {
        id: "decedent_beneficiaries",
        order: 26,
        group: "parties",
        prompt: copy("q.decedent_beneficiaries", "Who are the spouse, children, or other close family members who may have a claim because of this death?"),
        answerType: "long_text",
        matterTypes: ["wrongful_death"],
        required: true,
        staffNote: "Each named beneficiary is a related party for the conflict index, not only a contact.",
      },
      // --- The case: date of injury is asked first among case questions ---
      {
        id: "date_of_injury",
        order: 30,
        group: "case",
        prompt: copy("q.date_of_injury", "What date were you injured?"),
        answerType: "date",
        matterTypes: ALL,
        required: true,
        staffNote: "Asked first among case questions, so the limitation date can be tracked and double-checked (c93) as early as possible. If this date looks old relative to the applicable limitations period, flag for an immediate lawyer review (rules.limitation_periods) — never calculate or state a deadline to the client.",
      },
      {
        id: "date_of_death",
        order: 31,
        group: "case",
        prompt: copy("q.date_of_death", "What date did your family member pass away?"),
        answerType: "date",
        matterTypes: ["wrongful_death"],
        required: true,
        staffNote: "A wrongful-death limitations period runs from this date, not from the date of the underlying injury (rules.limitation_periods, rule reference wrongful_death_accrual). Flag for lawyer review alongside date_of_injury.",
      },
      {
        id: "help_wanted",
        order: 32,
        group: "case",
        prompt: copy("q.help_wanted", "In a few sentences, what happened and what would you like help with?"),
        answerType: "long_text",
        matterTypes: ALL,
        required: true,
      },
      {
        id: "injury_description",
        order: 33,
        group: "case",
        prompt: copy("q.injury_description", "Please describe your injuries and the medical care you have received so far."),
        answerType: "long_text",
        matterTypes: ALL,
        required: true,
      },
      {
        id: "incident_location",
        order: 34,
        group: "case",
        prompt: copy("q.incident_location", "Where did this happen? Please give an address, intersection, or business name, and the city and county."),
        answerType: "short_text",
        matterTypes: ALL,
        required: true,
      },
      {
        id: "police_or_incident_report_filed",
        order: 35,
        group: "case",
        prompt: copy("q.police_or_incident_report_filed", "Was a police report or an incident report made? If so, by whom?"),
        answerType: "yes_no_unsure",
        matterTypes: ["car_truck_crash", "workplace_injury", "dog_bite"],
        required: false,
      },
      {
        id: "vehicle_or_other_details",
        order: 36,
        group: "case",
        prompt: copy("q.vehicle_or_other_details", "What vehicles were involved, and do you know who insures them?"),
        answerType: "long_text",
        matterTypes: ["car_truck_crash"],
        required: false,
      },
      {
        id: "dog_bite_history",
        order: 37,
        group: "case",
        prompt: copy("q.dog_bite_history", "Do you know who owns the dog, and do you know if that dog has bitten anyone before?"),
        answerType: "long_text",
        matterTypes: ["dog_bite"],
        required: false,
      },
      {
        id: "workers_comp_claim_filed",
        order: 38,
        group: "case",
        prompt: copy("q.workers_comp_claim_filed", "Have you filed, or started, a workers'-compensation claim for this injury?"),
        answerType: "yes_no_unsure",
        matterTypes: ["workplace_injury"],
        required: false,
      },
      {
        id: "existing_claim_or_lawsuit",
        order: 39,
        group: "case",
        prompt: copy("q.existing_claim_or_lawsuit", "Have you already filed an insurance claim or a lawsuit about this?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: false,
      },
      {
        id: "demand_or_offer_received",
        order: 40,
        group: "case",
        prompt: copy("q.demand_or_offer_received", "Has anyone already sent a demand letter, or has an insurance company made an offer?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: false,
        staffNote: "Feeds the demand-letters-and-offers tracking checklist.",
      },
      // --- Finances: health coverage drives lien tracking ---
      {
        id: "health_coverage_at_time_of_injury",
        order: 50,
        group: "finances",
        prompt: copy(
          "q.health_coverage_at_time_of_injury",
          "At the time you were injured, did you have health insurance, Medicaid, Medicare, or VA benefits that may have paid for any of your treatment?"
        ),
        answerType: "choice",
        choices: ["health_insurance", "medicaid", "medicare", "va", "none", "unsure"],
        matterTypes: ALL,
        required: true,
        staffNote: "Any answer other than 'none' opens a lien-tracking entry; hospital, health-insurer, and Medicare liens must be identified before any settlement is disbursed.",
      },
      {
        id: "missed_work_due_to_injury",
        order: 51,
        group: "finances",
        prompt: copy("q.missed_work_due_to_injury", "Have you missed work because of your injuries?"),
        answerType: "yes_no_unsure",
        matterTypes: ALL,
        required: false,
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
        "Your safety comes first. If you are in danger, call 911. If someone may be reading your email or texts, tell us a safer way to reach you before you share details."
      ),
      signalResponse: copy(
        "safety_signal_response",
        "Thank you for telling us. A member of our team has been alerted and will contact you using the safe method you chose. If you are in danger now, call 911."
      ),
    },
  },

  // -------------------------------------------------------------------------
  // Conflict check: the at-fault party/defendant, co-defendants, the
  // insurance carrier, the property owner or employer, and decedent's
  // beneficiaries are all indexed.
  // -------------------------------------------------------------------------
  conflicts: {
    partyRoles: [
      { id: "client", label: "Client", partyRole: "client", indexRole: "client", relationship: "client", adverseByDefault: false, askAtIntake: false, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ALL },
      { id: "at_fault_party", label: "At-fault party / defendant", partyRole: "opposing_party", indexRole: "opposing_party", relationship: "defendant", adverseByDefault: true, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: true, matterTypes: ALL },
      { id: "insurance_carrier", label: "Insurance carrier / adjuster", partyRole: "related_party", indexRole: "insurer", relationship: "insurer", adverseByDefault: false, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ALL },
      { id: "co_defendant", label: "Co-defendant", partyRole: "co_party", indexRole: "co_defendant", relationship: "co-defendant", adverseByDefault: true, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ALL },
      { id: "property_owner", label: "Property owner / business", partyRole: "opposing_party", indexRole: "opposing_party", relationship: "premises owner", adverseByDefault: true, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: PREMISES_TYPES },
      { id: "employer", label: "Employer", partyRole: "opposing_party", indexRole: "opposing_party", relationship: "employer", adverseByDefault: true, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ["workplace_injury"] },
      { id: "decedent_beneficiary", label: "Decedent's beneficiary / family member", partyRole: "related_party", indexRole: "related_party", relationship: "beneficiary", adverseByDefault: false, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ["wrongful_death"] },
      { id: "opposing_counsel", label: "Other side's lawyer", partyRole: "opposing_counsel", indexRole: "opposing_counsel", relationship: "opposing counsel", adverseByDefault: true, askAtIntake: true, indexByDefault: true, blocksClearIfUnnamed: false, matterTypes: ALL },
    ],
  },

  // -------------------------------------------------------------------------
  // Documents: medical providers/records/bills, insurance claims/adjusters/
  // policy limits, demand letters and offers, and liens are all tracked.
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
          { id: "client_medical_auth", name: "Medical authorizations and provider information", defaultPrivilege: "confidential", clientVisibleFolder: true },
          { id: "client_incident", name: "Incident records", defaultPrivilege: "confidential", clientVisibleFolder: true },
          { id: "client_wage_loss", name: "Wage and income loss records", defaultPrivilege: "confidential", clientVisibleFolder: true },
        ],
      },
      { id: "medical", name: "Medical providers, records and bills", defaultPrivilege: "confidential" },
      { id: "insurance", name: "Insurance claims and adjusters", defaultPrivilege: "confidential" },
      { id: "demand_settlement", name: "Demand letters, offers and settlement", defaultPrivilege: "confidential" },
      { id: "liens", name: "Liens (hospital, health insurer, Medicare)", defaultPrivilege: "confidential" },
      { id: "pleadings", name: "Pleadings and filings", defaultPrivilege: "none" },
      { id: "work_product", name: "Attorney notes and work product", defaultPrivilege: "work_product" },
      { id: "billing", name: "Billing and trust", defaultPrivilege: "confidential" },
    ],
    checklists: [
      {
        id: "pi_core",
        label: "Personal injury: medical, insurance, demand, and settlement tracking",
        items: [
          { id: "medical_authorization_form", label: "Medical-records authorization (signed)", providedBy: "firm", required: true, folderId: "client_medical_auth", templateId: "medical_records_authorization" },
          { id: "provider_list", label: "Medical providers who treated the client", providedBy: "client", required: true, folderId: "client_medical_auth", clientRequest: copy("doc.provider_list", "The names and contact information of every doctor, hospital, or other provider who treated you.") },
          { id: "incident_report_or_photos", label: "Incident records (photos, video, reports)", providedBy: "client", required: false, folderId: "client_incident", clientRequest: copy("doc.incident_report_or_photos", "Any photos, videos, or copies of an incident or police report you have, if it is safe for you to share them.") },
          { id: "wage_and_income_records", label: "Wage and income-loss records", providedBy: "client", required: false, folderId: "client_wage_loss", clientRequest: copy("doc.wage_and_income_records", "Recent pay stubs or other proof of the income you have lost because of your injuries.") },
          { id: "medical_records_tracking_log", label: "Medical-records requests and receipt log", providedBy: "firm", required: true, folderId: "medical" },
          { id: "medical_bills_log", label: "Medical bills log", providedBy: "firm", required: false, folderId: "medical" },
          { id: "insurance_claim_information", label: "Insurance claim information", providedBy: "client", required: true, folderId: "insurance", clientRequest: copy("doc.insurance_claim_information", "The insurance company names and claim numbers for your own insurance and, if you know them, for the other side.") },
          { id: "adjuster_correspondence_log", label: "Adjuster correspondence log", providedBy: "firm", required: false, folderId: "insurance" },
          { id: "policy_limits_tracking", label: "Policy-limits tracking", providedBy: "firm", required: false, folderId: "insurance" },
          { id: "demand_letter_doc", label: "Demand letter (lawyer-reviewed template)", providedBy: "firm", required: true, folderId: "demand_settlement", templateId: "demand_letter" },
          { id: "settlement_offers_log", label: "Settlement offers log", providedBy: "firm", required: false, folderId: "demand_settlement" },
          { id: "pi_engagement_agreement_doc", label: "Contingency-fee engagement agreement (signed)", providedBy: "firm", required: true, folderId: "engagement", templateId: "pi_engagement_agreement" },
          { id: "settlement_statement_doc", label: "Written settlement statement (Rule 1.04(d))", providedBy: "firm", required: true, folderId: "demand_settlement", templateId: "settlement_statement" },
          { id: "lien_tracking_log", label: "Lien tracking log (hospital, health insurer, Medicare)", providedBy: "firm", required: true, folderId: "liens" },
          { id: "pi_petition_doc", label: "Petition (lawyer-reviewed template, if suit is filed)", providedBy: "firm", required: false, folderId: "pleadings", templateId: "pi_petition" },
        ],
      },
      {
        id: "wrongful_death_core",
        label: "Wrongful death: beneficiaries and estate",
        items: [
          { id: "death_certificate", label: "Death certificate", providedBy: "client", required: true, folderId: "client_incident", clientRequest: copy("doc.death_certificate", "A copy of the death certificate, if you have it.") },
          { id: "beneficiary_information", label: "Beneficiary information", providedBy: "client", required: true, folderId: "client_incident", clientRequest: copy("doc.beneficiary_information", "The names, contact information, and relationship to the decedent of each family member who may have a claim.") },
          { id: "estate_or_probate_documents", label: "Estate or probate documents", providedBy: "client", required: false, folderId: "client_incident", clientRequest: copy("doc.estate_or_probate_documents", "Any paperwork naming an executor or administrator of the estate, if one has been appointed.") },
          { id: "wrongful_death_petition_doc", label: "Wrongful-death petition (lawyer-reviewed template)", providedBy: "firm", required: false, folderId: "pleadings", templateId: "wrongful_death_petition" },
        ],
      },
      {
        id: "premises_liability_core",
        label: "Premises liability (slip and fall, dog bite)",
        items: [
          { id: "property_or_owner_information", label: "Property, business, or dog owner information", providedBy: "client", required: true, folderId: "client_incident", clientRequest: copy("doc.property_or_owner_information", "The name and address of the property owner, manager, or dog owner, if you know it.") },
          { id: "prior_incident_information", label: "Prior similar incidents", providedBy: "client", required: false, folderId: "client_incident", clientRequest: copy("doc.prior_incident_information", "Anything you know about prior similar incidents at this property or with this animal.") },
        ],
      },
      {
        id: "workplace_injury_core",
        label: "Workplace injury",
        items: [
          { id: "employer_and_workers_comp_information", label: "Employer and workers'-compensation information", providedBy: "client", required: true, folderId: "client_incident", clientRequest: copy("doc.employer_and_workers_comp_information", "Your employer's name, and whether you have filed a workers'-compensation claim.") },
          { id: "workplace_incident_report", label: "Workplace incident or safety report", providedBy: "client", required: false, folderId: "client_incident", clientRequest: copy("doc.workplace_incident_report", "Any incident report or safety report your employer completed, if you have a copy.") },
        ],
      },
    ],
    templates: [
      { id: "pi_engagement_agreement", label: "Contingency-fee engagement agreement", kind: "agreement", gateKey: SHARED_RULE_KEYS.feeAgreementTerms, matterTypes: ALL },
      { id: "medical_records_authorization", label: "Medical-records authorization", kind: "letter", gateKey: PERSONAL_INJURY_RULE_KEYS.starterTemplates, matterTypes: ALL },
      { id: "demand_letter", label: "Demand letter", kind: "letter", gateKey: PERSONAL_INJURY_RULE_KEYS.starterTemplates, matterTypes: ALL },
      { id: "settlement_statement", label: "Written settlement statement (Rule 1.04(d))", kind: "disclosure", gateKey: SHARED_RULE_KEYS.feeAgreementTerms, matterTypes: ALL },
      { id: "pi_petition", label: "Personal-injury petition", kind: "petition", gateKey: PERSONAL_INJURY_RULE_KEYS.starterTemplates, matterTypes: ALL },
      { id: "wrongful_death_petition", label: "Wrongful-death petition", kind: "petition", gateKey: PERSONAL_INJURY_RULE_KEYS.starterTemplates, matterTypes: ["wrongful_death"] },
    ],
  },

  // -------------------------------------------------------------------------
  // Task lists — workflow suggestions, internal, business days.
  // -------------------------------------------------------------------------
  tasks: {
    lists: [
      {
        id: "pi_opening",
        label: "Every new personal-injury matter",
        trigger: { on: "matter_opened" },
        matterTypes: ALL,
        tasks: [
          { id: "lawyer_verifies_limitation_date", title: "Lawyer verifies and double-checks the limitation date from the reported date of injury", assigneeRole: "lawyer", dueBusinessDays: 1, kind: "all-engines.personal_injury.lawyer_verifies_limitation_date", ruleRef: "statute_of_limitations", visibility: "internal" },
          { id: "track_medical_records_requests", title: "Open the medical-records-and-bills tracking log and send initial requests", assigneeRole: "paralegal", dueBusinessDays: 2, kind: "all-engines.personal_injury.track_medical_records_requests", visibility: "internal" },
          { id: "confirm_parties_and_insurance_indexed", title: "Confirm the at-fault party, co-defendants, and insurance carrier are on the matter and in the conflict index", assigneeRole: "paralegal", dueBusinessDays: 1, kind: "all-engines.personal_injury.confirm_parties_and_insurance_indexed", visibility: "internal" },
          { id: "send_document_checklist", title: "Send the document checklist and medical-records authorization through the portal", assigneeRole: "intake_staff", dueBusinessDays: 2, kind: "all-engines.personal_injury.send_document_checklist", visibility: "internal" },
          { id: "lawyer_confirms_engagement_agreement", title: "Lawyer confirms the signed contingency-fee engagement agreement is in place and matches Rule 1.04(d)", assigneeRole: "lawyer", dueBusinessDays: 2, kind: "all-engines.personal_injury.lawyer_confirms_engagement_agreement", ruleRef: "contingency_fee_agreement_rule", visibility: "internal" },
        ],
      },
      {
        id: "wrongful_death_opening",
        label: "Wrongful death: first steps",
        trigger: { on: "matter_opened" },
        matterTypes: ["wrongful_death"],
        tasks: [
          { id: "lawyer_verifies_wrongful_death_accrual", title: "Lawyer verifies the wrongful-death accrual date separately from the date of injury", assigneeRole: "lawyer", dueBusinessDays: 1, kind: "all-engines.personal_injury.lawyer_verifies_wrongful_death_accrual", ruleRef: "wrongful_death_accrual", visibility: "internal" },
          { id: "confirm_beneficiaries_identified", title: "Confirm every named beneficiary is on the matter and in the conflict index", assigneeRole: "paralegal", dueBusinessDays: 3, kind: "all-engines.personal_injury.confirm_beneficiaries_identified", visibility: "internal" },
        ],
      },
      {
        id: "investigation",
        label: "Investigation",
        trigger: { on: "stage_entered", stageId: "investigation" },
        matterTypes: ALL,
        tasks: [
          { id: "open_insurance_claims", title: "Open insurance claims with the client's and the at-fault party's carriers", assigneeRole: "paralegal", dueBusinessDays: 3, kind: "all-engines.personal_injury.open_insurance_claims", visibility: "internal" },
          { id: "request_policy_limits", title: "Request policy-limits confirmation from each known carrier", assigneeRole: "paralegal", dueBusinessDays: 5, kind: "all-engines.personal_injury.request_policy_limits", visibility: "internal" },
        ],
      },
      {
        id: "medical_treatment_and_records",
        label: "Medical treatment and records",
        trigger: { on: "stage_entered", stageId: "medical_treatment_and_records" },
        matterTypes: ALL,
        tasks: [
          { id: "request_medical_records_and_bills", title: "Request medical records and itemized bills from every named provider", assigneeRole: "paralegal", dueBusinessDays: 3, kind: "all-engines.personal_injury.request_medical_records_and_bills", visibility: "internal" },
          { id: "follow_up_outstanding_records", title: "Follow up on outstanding medical-records and bill requests", assigneeRole: "paralegal", dueBusinessDays: 10, kind: "all-engines.personal_injury.follow_up_outstanding_records", visibility: "internal" },
        ],
      },
      {
        id: "demand_and_negotiation",
        label: "Demand and negotiation",
        trigger: { on: "stage_entered", stageId: "demand_and_negotiation" },
        matterTypes: ALL,
        tasks: [
          { id: "prepare_demand_letter", title: "Prepare the demand letter from the reviewed template, with supporting records attached", assigneeRole: "paralegal", dueBusinessDays: 5, kind: "all-engines.personal_injury.prepare_demand_letter", visibility: "internal" },
          { id: "lawyer_reviews_demand_letter", title: "Lawyer reviews and approves the demand letter before it is sent", assigneeRole: "lawyer", dueBusinessDays: 7, kind: "all-engines.personal_injury.lawyer_reviews_demand_letter", visibility: "internal" },
          { id: "log_settlement_offers", title: "Log every settlement offer and counter-offer", assigneeRole: "paralegal", dueBusinessDays: 2, kind: "all-engines.personal_injury.log_settlement_offers", visibility: "internal" },
        ],
      },
      {
        id: "settlement_or_resolution",
        label: "Settlement or resolution",
        trigger: { on: "stage_entered", stageId: "settlement_or_resolution" },
        matterTypes: ALL,
        tasks: [
          { id: "prepare_settlement_statement", title: "Prepare the written settlement statement (recovery, fee, expenses, net to client)", assigneeRole: "paralegal", dueBusinessDays: 3, kind: "all-engines.personal_injury.prepare_settlement_statement", visibility: "internal" },
          { id: "lawyer_approves_settlement_statement", title: "Lawyer reviews and approves the settlement statement against Rule 1.04(d) before it goes to the client", assigneeRole: "lawyer", dueBusinessDays: 5, kind: "all-engines.personal_injury.lawyer_approves_settlement_statement", ruleRef: "contingency_fee_agreement_rule", visibility: "internal" },
        ],
      },
      {
        id: "disbursement",
        label: "Trust disbursement",
        trigger: { on: "stage_entered", stageId: "disbursement" },
        matterTypes: ALL,
        tasks: [
          { id: "confirm_liens_resolved_before_disbursement", title: "Lawyer confirms every hospital, health-insurer, and Medicare lien is resolved or accounted for before any disbursement", assigneeRole: "lawyer", dueBusinessDays: 2, kind: "all-engines.personal_injury.confirm_liens_resolved_before_disbursement", ruleRef: "lien_resolution_before_disbursement", visibility: "internal" },
          { id: "bookkeeper_prepares_trust_disbursement", title: "Bookkeeper prepares the trust disbursement ledger entries once liens are confirmed resolved", assigneeRole: "bookkeeper", dueBusinessDays: 3, kind: "all-engines.personal_injury.bookkeeper_prepares_trust_disbursement", visibility: "internal" },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Stages
  // -------------------------------------------------------------------------
  stages: {
    tracks: [
      {
        id: "personal_injury_case",
        label: "Personal injury case (intake to disbursement)",
        stages: [
          { id: "consultation", label: "Consultation", systemStage: "prospective", clientLabel: copy("stage.consultation", "Consultation") },
          { id: "retained", label: "Retained", systemStage: "retained", clientLabel: copy("stage.retained", "Getting started") },
          { id: "investigation", label: "Investigation", clientLabel: copy("stage.investigation", "Investigating your claim") },
          { id: "medical_treatment_and_records", label: "Medical treatment and records", clientLabel: copy("stage.medical_treatment_and_records", "Gathering your medical records") },
          { id: "demand_and_negotiation", label: "Demand and negotiation", clientLabel: copy("stage.demand_and_negotiation", "Negotiating your claim") },
          { id: "settlement_or_resolution", label: "Settlement or resolution", clientLabel: copy("stage.settlement_or_resolution", "Resolving your claim") },
          { id: "disbursement", label: "Trust disbursement", clientLabel: copy("stage.disbursement", "Finalizing your payment") },
          { id: "closed", label: "Closed", systemStage: "closed", clientLabel: copy("stage.closed", "Closed") },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Deadlines and Texas rules — REFERENCES ONLY, lawyer tools, no values.
  // -------------------------------------------------------------------------
  deadlines: {
    rules: [
      {
        id: "statute_of_limitations",
        label: "Personal injury limitations calculator",
        kind: "limitation_period",
        gateKey: SHARED_RULE_KEYS.limitationPeriods,
        ownerEngine: "calendar-core",
        matterTypes: ALL,
        audience: "lawyer_tool",
        note: "Proposes the limitation date from the reported date of injury for a lawyer to confirm (c93). Texas's general civil personal-injury limitations period and its exceptions (minors, the discovery rule, governmental-entity notice requirements, and others) are gated and reviewed by an attorney; never calculated or told to a client as a date by this pack.",
      },
      {
        id: "wrongful_death_accrual",
        label: "Wrongful-death accrual and limitations calculator",
        kind: "limitation_period",
        gateKey: SHARED_RULE_KEYS.limitationPeriods,
        ownerEngine: "calendar-core",
        matterTypes: ["wrongful_death"],
        audience: "lawyer_tool",
        note: "A wrongful-death claim's limitations period runs from the date of death, not the date of the underlying injury, so this reference exists separately from 'statute_of_limitations' and must be confirmed by a lawyer on its own.",
      },
      {
        id: "lien_resolution_before_disbursement",
        label: "Lien identification and resolution before trust disbursement",
        kind: "eligibility_rule",
        gateKey: PERSONAL_INJURY_RULE_KEYS.lienResolutionBeforeDisbursement,
        ownerEngine: "billing-trust",
        matterTypes: ALL,
        audience: "lawyer_tool",
        note: "Hospital, health-insurer, and Medicare liens — including Medicare's conditional-payment reimbursement right — must be identified and resolved, or otherwise accounted for, before settlement funds are released from trust (see also rules.trust_accounting). Content and process pending attorney and CPA review.",
      },
      {
        id: "contingency_fee_agreement_rule",
        label: "Contingency-fee agreement and settlement-statement requirements",
        kind: "statutory_form",
        gateKey: SHARED_RULE_KEYS.feeAgreementTerms,
        ownerEngine: "billing-trust",
        matterTypes: ALL,
        audience: "lawyer_tool",
        note: "Texas Disciplinary Rules of Professional Conduct Rule 1.04(d) requires a written contingency-fee agreement stating the method of determining the fee, including any difference in percentage at each stage of the matter, and how expenses are calculated and deducted, plus a written settlement statement to the client when a contingent matter concludes. Wording pending attorney review.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Billing — contingency fee is the default and primary model for this area.
  // -------------------------------------------------------------------------
  billing: {
    defaultFeeType: "contingency",
    offeredFeeTypes: ["contingency", "hourly", "hybrid"],
    withheldFeeTypes: [],
    retainerFloorFromFirmSettings: true,
    feeTermsGateKey: SHARED_RULE_KEYS.feeAgreementTerms,
    trustGateKey: SHARED_RULE_KEYS.trustAccounting,
    perMatterType: {
      workplace_injury: "hybrid",
    },
  },
};
