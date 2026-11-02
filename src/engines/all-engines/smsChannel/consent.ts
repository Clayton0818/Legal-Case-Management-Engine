// c113 — two-way SMS/text channel: pure consent/keyword and phone-matching
// helpers (no I/O). TCPA opt-out ("STOP" and friends) has to be honoured on
// every inbound text regardless of any vendor DPA or copy-gate approval — the
// same "honouring a stop is always safe" principle the intake engine already
// applies to its own channel (src/engines/intake/followUp/sequence.ts). This
// module intentionally duplicates that small amount of logic rather than
// importing it: engines may never import another engine
// (src/engines/README.md), and consent-keyword parsing is cheap enough that
// duplicating it is far safer than coupling two engines over it.

/** Case-management client SMS (post-retention). Separate from the intake
 * engine's own inbound-SMS handling during triage (c65/c70) — this is the
 * "two-way text with an existing matter's client" gap c113 describes. */
export type InboundSmsKeyword = "stop" | "start" | "help" | null;

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "alto", "parar", "cancelar", "basta"]);
const START_WORDS = new Set(["start", "unstop", "yes", "si", "sí"]);
const HELP_WORDS = new Set(["help", "info", "ayuda"]);

function normalizeKeyword(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Classify one inbound text as a TCPA keyword, or null for an ordinary
 * message. Only matches when the ENTIRE message (trimmed) is the keyword —
 * "stop by the office tomorrow" must never be read as an opt-out.
 */
export function classifyInboundSmsKeyword(body: string): InboundSmsKeyword {
  const word = normalizeKeyword(body.trim());
  if (!word) return null;
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return null;
}

/** Strip everything but digits, and drop a US/Canada country code for comparison. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length >= 7 && na === nb;
}

/** Every phone-shaped value on a party worth matching an inbound "From" number against. */
export function candidatePartyPhones(party: {
  phone?: string | null;
  phones?: readonly string[] | null;
  safeContact?: { safePhone?: string | null } | null;
}): string[] {
  return [party.safeContact?.safePhone, party.phone, ...(party.phones ?? [])].filter((p): p is string => Boolean(p && p.trim()));
}
