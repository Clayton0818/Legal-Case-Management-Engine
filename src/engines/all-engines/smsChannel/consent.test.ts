import { describe, expect, it } from "vitest";
import { candidatePartyPhones, classifyInboundSmsKeyword, normalizePhone, phonesMatch } from "./consent";

describe("classifyInboundSmsKeyword", () => {
  it("matches the whole message, case/accent/whitespace-insensitively", () => {
    expect(classifyInboundSmsKeyword("STOP")).toBe("stop");
    expect(classifyInboundSmsKeyword("  stop  ")).toBe("stop");
    expect(classifyInboundSmsKeyword("Cancelar")).toBe("stop");
    expect(classifyInboundSmsKeyword("start")).toBe("start");
    expect(classifyInboundSmsKeyword("Sí")).toBe("start");
    expect(classifyInboundSmsKeyword("HELP")).toBe("help");
  });

  it("never treats a keyword inside an ordinary sentence as an opt-out/in", () => {
    expect(classifyInboundSmsKeyword("stop by the office tomorrow at 2")).toBeNull();
    expect(classifyInboundSmsKeyword("can you help me understand the invoice?")).toBeNull();
  });

  it("returns null for an empty or ordinary message", () => {
    expect(classifyInboundSmsKeyword("")).toBeNull();
    expect(classifyInboundSmsKeyword("   ")).toBeNull();
    expect(classifyInboundSmsKeyword("Thanks, see you then.")).toBeNull();
  });
});

describe("normalizePhone / phonesMatch", () => {
  it("strips formatting and a leading US/Canada country code", () => {
    expect(normalizePhone("+1 (512) 555-0134")).toBe("5125550134");
    expect(normalizePhone("512-555-0134")).toBe("5125550134");
    expect(normalizePhone("15125550134")).toBe("5125550134");
  });

  it("matches numbers written differently but refuses to match short/empty values", () => {
    expect(phonesMatch("+1 512-555-0134", "(512) 555-0134")).toBe(true);
    expect(phonesMatch("555-0134", "0134")).toBe(false);
    expect(phonesMatch(null, "512-555-0134")).toBe(false);
    expect(phonesMatch("", "")).toBe(false);
  });
});

describe("candidatePartyPhones", () => {
  it("prefers the safe phone but includes every phone-shaped value, de-duplicated by caller", () => {
    expect(
      candidatePartyPhones({
        phone: "512-555-0100",
        phones: ["512-555-0101", ""],
        safeContact: { safePhone: "512-555-0199" },
      })
    ).toEqual(["512-555-0199", "512-555-0100", "512-555-0101"]);
  });

  it("returns an empty array when the party has no phone on file", () => {
    expect(candidatePartyPhones({})).toEqual([]);
  });
});
