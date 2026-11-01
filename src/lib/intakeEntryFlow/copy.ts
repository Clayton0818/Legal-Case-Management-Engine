// Caller-facing copy for the entry portion of the intake flow.
//
// IMPORTANT — NOT ATTORNEY-REVIEWED. Per ADR-0001 ("scripted client-facing
// language... eventually needs attorney review before real use") and
// CLAUDE.md's compliance guardrails ("when in doubt, under-claim"), none
// of the strings below have been reviewed by an attorney. They are
// functional placeholders written to satisfy intake-flow.yaml's
// requirements (a confirmed classification read back to the caller, an
// honest terminal message that doesn't overclaim what happened) without
// making any legal characterization or promise the firm hasn't
// authorized. Flagged again in this card's PR description for human
// review — do not treat this file as final, ship-ready copy. The Spanish
// strings added for board card c36 are plain translations of the same
// unreviewed placeholders and need the identical attorney sign-off before
// real use, applied to both languages (see c36's board note).
//
// Language scoping (c36): intake-flow.yaml's entry sequence is
// classify_caller -> capture_contact -> language_routing ->
// classify_practice_area, i.e. the caller's language preference isn't
// known yet at classify_caller or capture_contact. Those two nodes' copy
// (CALLER_TYPE_OPTIONS, askContact and its field labels) and the two
// nodes reachable directly from classify_caller without ever passing
// through language_routing (existingCallerHandoff, opposingPartyDeclined)
// stay English-only by design, not as a remaining gap — there is no
// selected language to render them in. ASK_LANGUAGE itself is shown
// before the caller has chosen, so it states the question in both
// languages at once rather than guessing. Everything reachable AFTER
// language_routing (classify_practice_area and out_of_scope_gate) is
// genuinely bilingual below via postLanguageCopy()/practiceAreaLabelsFor()
// /practiceAreaOptionsFor(), which is what was missing before.

import type { Language, PracticeAreaOrUnknown } from "./types";

export const CALLER_TYPE_OPTIONS = [
  { value: "potential_new_client", label: "I'm a new potential client" },
  { value: "existing_client", label: "I'm a current client" },
  { value: "former_client", label: "I'm a former client" },
  { value: "opposing_party", label: "I'm involved in a matter against this firm's client" },
  { value: "other", label: "Something else" },
] as const;

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const;

/** English-only defaults — still used directly for the pre-language-selection nodes. */
export const PRACTICE_AREA_LABELS: Record<PracticeAreaOrUnknown, string> = {
  family_divorce: "Divorce",
  family_custody: "Child custody",
  family_modification: "Modifying an existing family court order",
  family_enforcement: "Enforcing an existing family court order",
  family_other: "Another family law matter",
  expunction: "Expunction / clearing a criminal record",
  personal_injury: "Personal injury",
  mediation: "Mediation",
  unknown: "None of these / I'm not sure",
};

export const PRACTICE_AREA_OPTIONS = (
  Object.entries(PRACTICE_AREA_LABELS) as [PracticeAreaOrUnknown, string][]
).map(([value, label]) => ({ value, label }));

const PRACTICE_AREA_LABELS_ES: Record<PracticeAreaOrUnknown, string> = {
  family_divorce: "Divorcio",
  family_custody: "Custodia de los hijos",
  family_modification: "Modificar una orden familiar existente",
  family_enforcement: "Hacer cumplir una orden familiar existente",
  family_other: "Otro asunto de derecho familiar",
  expunction: "Expunción / eliminar un registro penal",
  personal_injury: "Lesiones personales",
  mediation: "Mediación",
  unknown: "Ninguna de estas / no estoy seguro",
};

/** Practice-area labels by language, for nodes reached after language_routing (c36). */
export const PRACTICE_AREA_LABELS_BY_LANGUAGE: Readonly<Record<Language, Record<PracticeAreaOrUnknown, string>>> = {
  en: PRACTICE_AREA_LABELS,
  es: PRACTICE_AREA_LABELS_ES,
};

function practiceAreaOptionsFor(language: Language): { value: PracticeAreaOrUnknown; label: string }[] {
  const labels = PRACTICE_AREA_LABELS_BY_LANGUAGE[language];
  return (Object.entries(labels) as [PracticeAreaOrUnknown, string][]).map(([value, label]) => ({ value, label }));
}

const PRACTICE_AREA_OPTIONS_BY_LANGUAGE: Readonly<Record<Language, { value: PracticeAreaOrUnknown; label: string }[]>> = {
  en: PRACTICE_AREA_OPTIONS,
  es: practiceAreaOptionsFor("es"),
};

/** Practice-area labels for the given (possibly not-yet-set) language. Pure. */
export function practiceAreaLabelsFor(language: Language | undefined): Record<PracticeAreaOrUnknown, string> {
  return PRACTICE_AREA_LABELS_BY_LANGUAGE[language ?? "en"];
}

/** Practice-area chip options for the given (possibly not-yet-set) language. Pure. */
export function practiceAreaOptionsForLanguage(language: Language | undefined): { value: PracticeAreaOrUnknown; label: string }[] {
  return PRACTICE_AREA_OPTIONS_BY_LANGUAGE[language ?? "en"];
}

export const COPY = {
  askCallerType: "First — how do you know this firm?",
  existingCallerHandoff:
    "Thanks — since you're already connected with this firm, we'll make sure your message reaches the right person on the team directly, rather than through this intake chat.",
  opposingPartyDeclined:
    "Thanks for letting us know. Because you're on the opposing side of a matter this firm may be involved in, we're not able to assist you here. If you'd like legal help of your own, your state or local bar association's lawyer referral service is a good place to start.",
  askContact: "Great — let's get your contact details so someone can follow up if we get disconnected.",
  fullNameLabel: "Full name",
  emailLabel: "Email address",
  phoneLabel: "Best callback number",
  // Shown before the caller has chosen a language, so it asks in both at
  // once rather than defaulting to English and hiding that a choice exists.
  askLanguage: "Which language do you prefer? / ¿Qué idioma prefiere?",
  askPracticeAreaFreeText:
    'In a sentence or two, what\'s going on? For example: "I want to file for divorce" or "I need help enforcing a custody order."',
  confirmGuess: (label: string) =>
    `Based on what you told us, this sounds like it may be a matter about: ${label}. Is that right?`,
  askManualPracticeArea: "No problem — which of these best describes your situation?",
  confirmYes: "Yes, that's right",
  confirmNo: "No, let me pick",
  entryComplete:
    "Thanks — someone from the firm will follow up with you. We've recorded what you've told us so far, so you won't need to repeat it.",
} as const;

export interface PostLanguageCopy {
  askPracticeAreaFreeText: string;
  confirmGuess: (label: string) => string;
  askManualPracticeArea: string;
  confirmYes: string;
  confirmNo: string;
  entryComplete: string;
}

const POST_LANGUAGE_COPY_EN: PostLanguageCopy = {
  askPracticeAreaFreeText: COPY.askPracticeAreaFreeText,
  confirmGuess: COPY.confirmGuess,
  askManualPracticeArea: COPY.askManualPracticeArea,
  confirmYes: COPY.confirmYes,
  confirmNo: COPY.confirmNo,
  entryComplete: COPY.entryComplete,
};

const POST_LANGUAGE_COPY_ES: PostLanguageCopy = {
  askPracticeAreaFreeText:
    'En una o dos frases, cuéntenos qué está pasando. Por ejemplo: "quiero solicitar el divorcio" o "necesito ayuda para hacer cumplir una orden de custodia."',
  confirmGuess: (label: string) =>
    `Según lo que nos contó, esto parece ser un asunto sobre: ${label}. ¿Es correcto?`,
  askManualPracticeArea: "No hay problema — ¿cuál de estas opciones describe mejor su situación?",
  confirmYes: "Sí, eso es correcto",
  confirmNo: "No, déjeme elegir",
  entryComplete:
    "Gracias — alguien de la firma se comunicará con usted. Hemos registrado lo que nos ha contado hasta ahora, así que no tendrá que repetirlo.",
};

/** Copy for nodes reached after language_routing, by language (c36). */
export const POST_LANGUAGE_COPY: Readonly<Record<Language, PostLanguageCopy>> = {
  en: POST_LANGUAGE_COPY_EN,
  es: POST_LANGUAGE_COPY_ES,
};

/** The post-language-selection copy set for the given (possibly not-yet-set) language. Pure. */
export function postLanguageCopy(language: Language | undefined): PostLanguageCopy {
  return POST_LANGUAGE_COPY[language ?? "en"];
}
