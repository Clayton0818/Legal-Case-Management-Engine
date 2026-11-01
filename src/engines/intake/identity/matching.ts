// c71 — Intake engine · spot repeat contacts: pure matching logic.
//
// Given a newly-arriving contact's name/phone/email/date-of-birth, decide
// how likely it is that an EXISTING `parties` row (src/db/schema.ts) is the
// same real person, and which fields matched. This file never merges or
// links anything — ./service.ts turns a match into a staff-reviewable
// suggestion row (`intake_contact_match_suggestions`), and only a human
// confirming one ever points a session at an existing party (c65 acceptance
// criterion 4; c71: "never auto-merges two different people").

export type MatchConfidence = "exact" | "likely" | "possible" | "none";

export interface NewContact {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  /** 'YYYY-MM-DD', matching parties.dateOfBirth's stored format. */
  dateOfBirth?: string | null;
}

export interface CandidateParty {
  partyId: string;
  fullName: string;
  normalizedName: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  /** Former/maiden names, nicknames (parties.aliases). */
  aliases?: readonly string[];
  /** Same aliases, normalised the same way as normalizedName (parties.normalizedAliases). */
  normalizedAliases?: readonly string[];
  emails?: readonly string[];
  phones?: readonly string[];
}

export interface MatchResult {
  partyId: string;
  confidence: MatchConfidence;
  matchedFields: string[];
  /** 0..1, informational only — the confidence tier is what callers act on. */
  score: number;
}

/** Lower-case, strip accents and punctuation, collapse whitespace — the same normalisation `parties.normalizedName` uses. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case, trim. Deliberately NOT gmail-dot/plus-insensitive — over-normalising would match unrelated people who share an email provider's quirk. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only, kept to the last 10 (US numbers, matching the rest of the product). A shorter number normalises to itself, so it still compares — just less usefully. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Same tokens in a different order count as the same name (e.g. a form captured "Last, First"). */
function nameIsClose(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = a.split(" ").filter(Boolean).sort().join(" ");
  const sb = b.split(" ").filter(Boolean).sort().join(" ");
  return sa === sb;
}

/**
 * Score one existing party against a newly-arriving contact. Pure: the
 * caller is responsible for tenant-scoping and for supplying the
 * candidate list — this function does no lookups of its own.
 */
export function scoreCandidate(incoming: NewContact, candidate: CandidateParty): MatchResult {
  const incomingName = normalizeName(incoming.fullName);
  const incomingEmail = incoming.email ? normalizeEmail(incoming.email) : null;
  const incomingPhone = incoming.phone ? normalizePhone(incoming.phone) : null;
  const incomingDob = incoming.dateOfBirth ?? null;

  const candidateEmails = [candidate.email, ...(candidate.emails ?? [])]
    .filter((e): e is string => !!e)
    .map(normalizeEmail);
  const candidatePhones = [candidate.phone, ...(candidate.phones ?? [])]
    .filter((p): p is string => !!p)
    .map(normalizePhone);

  const matchedFields: string[] = [];

  let nameMatches = false;
  let aliasOnly = false;
  if (nameIsClose(incomingName, candidate.normalizedName)) {
    nameMatches = true;
  } else {
    for (const alias of candidate.normalizedAliases ?? []) {
      if (nameIsClose(incomingName, alias)) {
        nameMatches = true;
        aliasOnly = true;
        break;
      }
    }
  }
  if (nameMatches) matchedFields.push(aliasOnly ? "aliasName" : "fullName");

  const emailMatches = incomingEmail !== null && candidateEmails.includes(incomingEmail);
  if (emailMatches) matchedFields.push("email");

  const phoneMatches = incomingPhone !== null && incomingPhone.length === 10 && candidatePhones.includes(incomingPhone);
  if (phoneMatches) matchedFields.push("phone");

  const dobMatches = incomingDob !== null && candidate.dateOfBirth != null && incomingDob === candidate.dateOfBirth;
  if (dobMatches) matchedFields.push("dateOfBirth");

  // Exact: a hard-to-coincidentally-share identifier matches on its own.
  if (emailMatches || phoneMatches) {
    return { partyId: candidate.partyId, confidence: "exact", matchedFields, score: 1 };
  }
  // Likely: the name matches AND a second independent signal (date of birth) also matches.
  if (nameMatches && dobMatches) {
    return { partyId: candidate.partyId, confidence: "likely", matchedFields, score: 0.85 };
  }
  // Possible: only the name (or an alias) matches — common names collide, so this is a weak
  // signal, but still worth a staff look rather than silently creating a duplicate record.
  if (nameMatches) {
    return { partyId: candidate.partyId, confidence: "possible", matchedFields, score: 0.4 };
  }
  // Date of birth alone, with no name match, is not worth surfacing (shared household, typos).
  return { partyId: candidate.partyId, confidence: "none", matchedFields: [], score: 0 };
}

/** Score every candidate and keep only the ones worth a staff suggestion (confidence != 'none'), highest first. */
export function findCandidateMatches(incoming: NewContact, candidates: readonly CandidateParty[]): MatchResult[] {
  return candidates
    .map((c) => scoreCandidate(incoming, c))
    .filter((m) => m.confidence !== "none")
    .sort((a, b) => b.score - a.score);
}

/**
 * c71's rule, made explicit at the call site rather than implicit in the
 * scorer: however strong a match is, it is a suggestion for a human to
 * confirm or reject — never an automatic merge. Kept as a function (not a
 * constant) so a reviewer can `grep` for the rule everywhere it is enforced.
 */
export function alwaysRequiresStaffConfirmation(_result: MatchResult): true {
  return true;
}
