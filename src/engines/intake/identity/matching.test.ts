import { describe, expect, it } from "vitest";
import {
  alwaysRequiresStaffConfirmation,
  findCandidateMatches,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  scoreCandidate,
  type CandidateParty,
  type NewContact,
} from "./matching";

function candidate(overrides: Partial<CandidateParty> = {}): CandidateParty {
  return {
    partyId: "party-1",
    fullName: "Jane A. Doe",
    normalizedName: normalizeName("Jane A. Doe"),
    email: "jane@example.com",
    phone: "(512) 555-0100",
    dateOfBirth: "1990-05-01",
    aliases: [],
    normalizedAliases: [],
    emails: [],
    phones: [],
    ...overrides,
  };
}

describe("normalize helpers", () => {
  it("normalizeName lower-cases, strips punctuation/accents and collapses whitespace", () => {
    expect(normalizeName("Jane A. Doe")).toBe("jane a doe");
    expect(normalizeName("José   Pérez")).toBe("jose perez");
  });

  it("normalizeEmail lower-cases and trims but does not touch dots or plus-addresses", () => {
    expect(normalizeEmail("  Jane@Example.com ")).toBe("jane@example.com");
    expect(normalizeEmail("jane.doe+intake@example.com")).toBe("jane.doe+intake@example.com");
  });

  it("normalizePhone keeps digits and the last 10", () => {
    expect(normalizePhone("(512) 555-0100")).toBe("5125550100");
    expect(normalizePhone("+1 512-555-0100")).toBe("5125550100");
    expect(normalizePhone("555-0100")).toBe("5550100");
  });
});

describe("scoreCandidate", () => {
  const incoming: NewContact = { fullName: "Jane Doe", email: "jane@example.com", phone: "512-555-0100", dateOfBirth: "1990-05-01" };

  it("is 'exact' on an email match alone, even if the name differs", () => {
    const result = scoreCandidate(
      { fullName: "Completely Different Name", email: "jane@example.com" },
      candidate()
    );
    expect(result.confidence).toBe("exact");
    expect(result.matchedFields).toContain("email");
  });

  it("is 'exact' on a phone match alone", () => {
    const result = scoreCandidate({ fullName: "Someone Else", phone: "5125550100" }, candidate());
    expect(result.confidence).toBe("exact");
    expect(result.matchedFields).toContain("phone");
  });

  it("is 'likely' when the name and date of birth both match but no contact detail does", () => {
    const result = scoreCandidate(
      { fullName: "Jane Doe", dateOfBirth: "1990-05-01" },
      candidate({ email: "different@example.com", phone: "555-0199" })
    );
    expect(result.confidence).toBe("likely");
    expect(result.matchedFields).toEqual(expect.arrayContaining(["fullName", "dateOfBirth"]));
  });

  it("is 'possible' on a name match alone", () => {
    const result = scoreCandidate(
      { fullName: "Jane Doe" },
      candidate({ email: "different@example.com", phone: "555-0199", dateOfBirth: "1975-01-01" })
    );
    expect(result.confidence).toBe("possible");
  });

  it("matches a former/maiden name recorded as an alias", () => {
    const result = scoreCandidate(
      { fullName: "Jane Smith" },
      candidate({ email: "x@example.com", phone: "555-0199", dateOfBirth: null, aliases: ["Jane Smith"], normalizedAliases: [normalizeName("Jane Smith")] })
    );
    expect(result.confidence).toBe("possible");
    expect(result.matchedFields).toEqual(["aliasName"]);
  });

  it("treats reordered name tokens as the same name", () => {
    const result = scoreCandidate({ fullName: "Doe Jane" }, candidate({ email: "x@example.com", phone: "555-0199" }));
    expect(result.matchedFields).toContain("fullName");
  });

  it("is 'none' when nothing meaningful lines up", () => {
    const result = scoreCandidate(
      { fullName: "Totally Unrelated Person", dateOfBirth: "1990-05-01" },
      candidate({ email: "x@example.com", phone: "555-0199" })
    );
    expect(result.confidence).toBe("none");
    expect(result.matchedFields).toEqual([]);
  });

  it("checks additional emails/phones on the candidate, not just the primary ones", () => {
    const result = scoreCandidate(
      { fullName: "Different Name", email: "second@example.com" },
      candidate({ email: "primary@example.com", emails: ["second@example.com"] })
    );
    expect(result.confidence).toBe("exact");
  });

  it("round-trips the happy path", () => {
    const result = scoreCandidate(incoming, candidate());
    expect(result.confidence).toBe("exact");
    expect(alwaysRequiresStaffConfirmation(result)).toBe(true);
  });
});

describe("findCandidateMatches", () => {
  it("drops 'none' matches and sorts the rest by score, highest first", () => {
    const incoming: NewContact = { fullName: "Jane Doe", email: "jane@example.com", dateOfBirth: "1990-05-01" };
    const candidates: CandidateParty[] = [
      candidate({ partyId: "none-match", fullName: "Nobody Related", email: "nobody@example.com", phone: "555-0001", dateOfBirth: "2000-01-01" }),
      candidate({ partyId: "possible-match", fullName: "Jane Doe", email: "other@example.com", phone: "555-0002", dateOfBirth: "1975-01-01" }),
      candidate({ partyId: "exact-match", fullName: "Jane Doe", email: "jane@example.com" }),
    ];
    const results = findCandidateMatches(incoming, candidates);
    expect(results.map((r) => r.partyId)).toEqual(["exact-match", "possible-match"]);
    expect(results[0]!.confidence).toBe("exact");
    expect(results[1]!.confidence).toBe("possible");
  });

  it("returns an empty list when there are no candidates", () => {
    expect(findCandidateMatches({ fullName: "Jane Doe" }, [])).toEqual([]);
  });
});
