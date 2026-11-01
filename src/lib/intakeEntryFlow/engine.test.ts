import { describe, it, expect } from "vitest";
import { advance, getPrompt } from "./engine";
import { IntakeValidationError } from "./types";
import type { CollectedAnswers } from "./types";

describe("intake entry flow (c23) — language scoping (c36)", () => {
  it("asks the language question bilingually before any language is known", () => {
    const prompt = getPrompt("language_routing", {});
    expect(prompt.message).toMatch(/Which language do you prefer/);
    expect(prompt.message).toMatch(/idioma/);
    expect(prompt.options?.map((o) => o.value)).toEqual(["en", "es"]);
  });

  it("classify_caller and capture_contact stay English regardless of a later-set language", () => {
    // These two nodes are reached before language_routing in the real
    // flow, so there is no selected language yet — getPrompt must not
    // depend on `answers.language` for them.
    const withSpanishAlreadyRecorded: CollectedAnswers = { language: "es" };
    expect(getPrompt("classify_caller", withSpanishAlreadyRecorded).message).toBe(
      "First — how do you know this firm?"
    );
    expect(getPrompt("capture_contact", withSpanishAlreadyRecorded).message).toBe(
      "Great — let's get your contact details so someone can follow up if we get disconnected."
    );
  });

  it("existing_caller_handoff and declined_conflict stay English (reached before language_routing)", () => {
    expect(getPrompt("existing_caller_handoff", {}).message).toMatch(/Thanks — since you're already connected/);
    expect(getPrompt("declined_conflict", {}).message).toMatch(/Thanks for letting us know/);
  });

  it("renders classify_practice_area and out_of_scope_gate in English by default", () => {
    const answers: CollectedAnswers = {};
    const ask = getPrompt("classify_practice_area", answers);
    expect(ask.message).toMatch(/In a sentence or two/);

    const confirmed: CollectedAnswers = { practiceArea: "family_divorce", practiceAreaConfirmed: true };
    expect(getPrompt("out_of_scope_gate", confirmed).message).toMatch(/Thanks — someone from the firm/);
  });

  it("renders classify_practice_area and out_of_scope_gate in Spanish once the caller chose es", () => {
    const freeText: CollectedAnswers = { language: "es" };
    expect(getPrompt("classify_practice_area", freeText).message).toMatch(/En una o dos frases/);

    const unknownGuess: CollectedAnswers = { language: "es", practiceArea: "unknown" };
    const manualPrompt = getPrompt("classify_practice_area", unknownGuess);
    expect(manualPrompt.message).toMatch(/No hay problema/);
    expect(manualPrompt.options).toBeDefined();
    // Every chip label is the Spanish translation, not the English default.
    expect(manualPrompt.options?.find((o) => o.value === "family_divorce")?.label).toBe("Divorcio");
    expect(manualPrompt.options?.find((o) => o.value === "unknown")?.label).toBe(
      "Ninguna de estas / no estoy seguro"
    );

    const guessPending: CollectedAnswers = { language: "es", practiceArea: "family_custody" };
    const confirmPrompt = getPrompt("classify_practice_area", guessPending);
    expect(confirmPrompt.kind).toBe("confirm");
    expect(confirmPrompt.message).toBe(
      "Según lo que nos contó, esto parece ser un asunto sobre: Custodia de los hijos. ¿Es correcto?"
    );
    expect(confirmPrompt.options).toEqual([
      { value: "yes", label: "Sí, eso es correcto" },
      { value: "no", label: "No, déjeme elegir" },
    ]);

    const confirmed: CollectedAnswers = {
      language: "es",
      practiceArea: "family_custody",
      practiceAreaConfirmed: true,
    };
    expect(getPrompt("out_of_scope_gate", confirmed).message).toMatch(/Gracias — alguien de la firma/);
  });

  it("advance() carries the chosen language from language_routing through to classify_practice_area", () => {
    const step = advance("language_routing", {}, { language: "es" });
    expect(step.collectedAnswers.language).toBe("es");
    expect(step.nextNode).toBe("classify_practice_area");
    expect(step.prompt.message).toMatch(/En una o dos frases/);
  });

  it("advance() rejects an unsupported language the same way regardless of locale", () => {
    expect(() => advance("language_routing", {}, { language: "fr" })).toThrow(IntakeValidationError);
  });

  it("a full English happy path ends at out_of_scope_gate with the English completion message", () => {
    let step = advance("classify_caller", {}, { callerType: "potential_new_client" });
    expect(step.nextNode).toBe("capture_contact");

    step = advance(step.nextNode, step.collectedAnswers, {
      fullName: "Jamie Rivera",
      email: "jamie@example.com",
      phone: "555-123-4567",
    });
    expect(step.nextNode).toBe("language_routing");

    step = advance(step.nextNode, step.collectedAnswers, { language: "en" });
    expect(step.nextNode).toBe("classify_practice_area");

    step = advance(step.nextNode, step.collectedAnswers, { practiceAreaFreeText: "I want to file for divorce" });
    expect(step.nextNode).toBe("classify_practice_area");
    expect(step.collectedAnswers.practiceArea).toBeDefined();

    step = advance(step.nextNode, step.collectedAnswers, { confirmed: true });
    expect(step.nextNode).toBe("out_of_scope_gate");
    expect(step.sessionEnded).toBe(true);
    expect(step.prompt.message).toMatch(/Thanks — someone from the firm/);
  });

  it("a full Spanish happy path ends at out_of_scope_gate with the Spanish completion message", () => {
    let step = advance("classify_caller", {}, { callerType: "potential_new_client" });
    step = advance(step.nextNode, step.collectedAnswers, {
      fullName: "Jamie Rivera",
      email: "jamie@example.com",
      phone: "555-123-4567",
    });
    step = advance(step.nextNode, step.collectedAnswers, { language: "es" });
    expect(step.prompt.message).toMatch(/En una o dos frases/);

    step = advance(step.nextNode, step.collectedAnswers, { practiceAreaFreeText: "Necesito ayuda con un divorcio" });
    expect(step.collectedAnswers.practiceArea).toBeDefined();
    expect(step.prompt.kind === "confirm" || step.prompt.kind === "single_choice").toBe(true);

    // Whichever branch the classifier landed on, reject it once so the
    // manual picker renders — and stays in Spanish.
    if (step.prompt.kind === "confirm") {
      step = advance(step.nextNode, step.collectedAnswers, { confirmed: false });
      expect(step.prompt.kind).toBe("single_choice");
      expect(step.prompt.message).toMatch(/No hay problema/);
    }

    const manualPick = step.prompt.options?.[0]?.value ?? "family_divorce";
    step = advance(step.nextNode, step.collectedAnswers, { manualPracticeArea: manualPick });
    expect(step.nextNode).toBe("out_of_scope_gate");
    expect(step.prompt.message).toMatch(/Gracias — alguien de la firma/);
  });
});
