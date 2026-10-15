import { describe, expect, it } from "vitest";
import {
  AI_FEATURES,
  AI_LANGUAGES,
  AI_MODELS,
  AI_PRICES,
  aiCostMicroUsd,
  cleanLicenceAnswer,
  contentTranslationJsonSchema,
  contentTranslationSchema,
  firstDistinct,
  hasDigit,
  hasNumberWord,
  hasWords,
  INSPECTION_SUMMARY_JSON_SCHEMA,
  inspectionSummaryAnswerSchema,
  LICENCE_ANSWER_JSON_SCHEMA,
  licenceAnswerSchema,
  microUsdToUsd,
  MONITORING_DIGEST_JSON_SCHEMA,
  monitoringDigestSchema,
  numbersIn,
  PHOTO_CHECK_JSON_SCHEMA,
  PHOTO_CHECK_VERDICTS,
  photoCheckSchema,
  photoNudgeFor,
  SCORE_EXPLANATION_JSON_SCHEMA,
  scoreExplanationSchema,
  missingLanguages,
  addMissingLanguages,
  storedTranslationFor,
  SUPPORT_TRANSLATION_JSON_SCHEMA,
  supportTranslationSchema,
  unknownIds,
  unknownNumbers,
  westernDigits,
  writtenInOwnScript,
  type AiJsonSchema,
} from "./ai.js";

describe("the price table", () => {
  it("has a price for every model the app may use", () => {
    for (const model of Object.values(AI_MODELS)) expect(AI_PRICES[model]).toBeDefined();
  });

  it("holds the prices read on Anthropic's pricing page on 14 Oct 2026", () => {
    expect(AI_PRICES["claude-haiku-5-5"].base).toMatchObject({ input: 0.1, output: 0.5 });
    expect(AI_PRICES["claude-haiku-5-5"].longPrompt).toMatchObject({ overTokens: 100_000, price: { input: 0.5, output: 2.5 } });
    expect(AI_PRICES["claude-sonnet-5-5"].base).toMatchObject({ input: 2, output: 10 });
    expect(AI_PRICES["claude-opus-5-5"].base).toMatchObject({ input: 4, output: 20 });
  });
});

describe("aiCostMicroUsd", () => {
  it("is tokens times the price per million, in millionths of a dollar", () => {
    // 1,000 in at $0.10/M = 100 µ$; 200 out at $0.50/M = 100 µ$.
    expect(aiCostMicroUsd("claude-haiku-5-5", { inputTokens: 1000, outputTokens: 200 })).toBe(200);
    // Sonnet: 1,000 × 2 + 500 × 10 = 7,000 µ$ = $0.007.
    expect(aiCostMicroUsd("claude-sonnet-5-5", { inputTokens: 1000, outputTokens: 500 })).toBe(7000);
    expect(microUsdToUsd(7000)).toBe(0.007);
  });

  it("rounds a fraction of a millionth up, never down", () => {
    // 3 × 0.1 = 0.3 µ$, kept as 1.
    expect(aiCostMicroUsd("claude-haiku-5-5", { inputTokens: 3, outputTokens: 0 })).toBe(1);
    expect(aiCostMicroUsd("claude-haiku-5-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
    // Exact sums have no floating-point leftovers: 10 × 0.1 is 1, not 2.
    expect(aiCostMicroUsd("claude-haiku-5-5", { inputTokens: 10, outputTokens: 0 })).toBe(1);
  });

  it("charges cache writes and reads at their own prices", () => {
    // Haiku: 1,000 written at $0.125/M = 125; 10,000 read at $0.01/M = 100.
    expect(aiCostMicroUsd("claude-haiku-5-5", { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1000, cacheReadTokens: 10_000 })).toBe(225);
  });

  it("charges Haiku's higher prices once the whole prompt is over 100,000 tokens, cache included", () => {
    const usage = { inputTokens: 100_000, outputTokens: 1000 };
    // Exactly 100,000 is still the lower price: 10,000 + 500.
    expect(aiCostMicroUsd("claude-haiku-5-5", usage)).toBe(10_500);
    // One token more of cache read tips the whole request over: 100,000 × 0.5 + 1 × 0.05 + 1,000 × 2.5.
    expect(aiCostMicroUsd("claude-haiku-5-5", { ...usage, cacheReadTokens: 1 })).toBe(52_501);
    // Sonnet has one price whatever the length.
    expect(aiCostMicroUsd("claude-sonnet-5-5", { inputTokens: 200_000, outputTokens: 0 })).toBe(400_000);
  });

  it("halves the cost for the Batch API", () => {
    expect(aiCostMicroUsd("claude-sonnet-5-5", { inputTokens: 1000, outputTokens: 500 }, { batch: true })).toBe(3500);
  });

  it("puts a typical licence photo read by Haiku well under a rupee", () => {
    // About 3,900 tokens for a 2000 × 1500 photo, 400 of instructions, 120 out.
    const micro = aiCostMicroUsd("claude-haiku-5-5", { inputTokens: 4300, outputTokens: 120 });
    expect(micro).toBe(490);
    expect(microUsdToUsd(micro) * 88).toBeLessThan(0.05);
  });
});

describe("the answer shapes", () => {
  /** Structured outputs need every property required and nothing else allowed, at every level. */
  function expectStrict(schema: AiJsonSchema) {
    const properties = schema.properties as Record<string, AiJsonSchema>;
    expect(schema.additionalProperties).toBe(false);
    expect([...(schema.required as string[])].sort()).toEqual(Object.keys(properties).sort());
    for (const property of Object.values(properties)) {
      if (property.type === "object") expectStrict(property);
      const items = property.items as AiJsonSchema | undefined;
      if (items?.type === "object") expectStrict(items);
    }
  }

  it("are strict JSON schemas whose properties match the Zod checks", () => {
    expectStrict(LICENCE_ANSWER_JSON_SCHEMA);
    expectStrict(SUPPORT_TRANSLATION_JSON_SCHEMA);
    expectStrict(SCORE_EXPLANATION_JSON_SCHEMA);
    expectStrict(contentTranslationJsonSchema(["hi", "te"]));
    expect(Object.keys(LICENCE_ANSWER_JSON_SCHEMA.properties as object).sort()).toEqual(Object.keys(licenceAnswerSchema.shape).sort());
    expect(Object.keys(SCORE_EXPLANATION_JSON_SCHEMA.properties as object).sort()).toEqual(Object.keys(scoreExplanationSchema.shape).sort());
  });

  it("accept 'could not read' for every licence field, and refuse anything else", () => {
    const blank = { type: null, number: null, issuedTo: null, issuedOn: null, expiresOn: null };
    expect(licenceAnswerSchema.safeParse(blank).success).toBe(true);
    expect(licenceAnswerSchema.safeParse({ ...blank, type: "DRIVING_LICENCE" }).success).toBe(false);
    expect(licenceAnswerSchema.safeParse({ ...blank, expiresOn: "31/03/2027" }).success).toBe(false);
    expect(licenceAnswerSchema.safeParse({ ...blank, extra: 1 }).success).toBe(true);
    expect(licenceAnswerSchema.safeParse({ type: null }).success).toBe(false);
  });

  it("make a content translation keep every language asked for", () => {
    const schema = contentTranslationSchema(["hi", "te"]);
    expect(schema.safeParse({ source: "en", languages: { hi: ["a"], te: ["b"] } }).success).toBe(true);
    expect(schema.safeParse({ source: "en", languages: { hi: ["a"] } }).success).toBe(false);
    expect(schema.safeParse({ source: "klingon", languages: { hi: ["a"], te: ["b"] } }).success).toBe(false);
  });

  it("make a support translation name its language", () => {
    expect(supportTranslationSchema.safeParse({ items: [{ id: "1", source: "te", text: "x" }] }).success).toBe(true);
    expect(supportTranslationSchema.safeParse({ items: [{ id: "1", text: "x" }] }).success).toBe(false);
  });

  it("need both sentences of an explanation", () => {
    expect(scoreExplanationSchema.safeParse({ costingMost: "a", doFirst: "b" }).success).toBe(true);
    expect(scoreExplanationSchema.safeParse({ costingMost: "", doFirst: "b" }).success).toBe(false);
    expect(scoreExplanationSchema.safeParse({ costingMost: "a", doFirst: " " }).success).toBe(false);
    expect(Object.keys(SCORE_EXPLANATION_JSON_SCHEMA.properties as object).sort()).toEqual(Object.keys(scoreExplanationSchema.shape).sort());
  });

  it("list four features under unique names", () => {
    expect(new Set(AI_FEATURES).size).toBe(AI_FEATURES.length);
    expect(AI_LANGUAGES).toHaveLength(12);
  });
});

describe("cleanLicenceAnswer", () => {
  const read = { type: "FSSAI" as const, number: "1362 2012 0004 56", issuedTo: "  Sample  Kitchen ", issuedOn: "2026-04-01", expiresOn: "2027-03-31" };

  it("takes the spaces out of a 14-digit FSSAI number and tidies the name", () => {
    expect(cleanLicenceAnswer(read)).toEqual({ ...read, number: "13622012000456", issuedTo: "Sample Kitchen" });
  });

  it("never passes on a date that does not exist or is out of range", () => {
    expect(cleanLicenceAnswer({ ...read, expiresOn: "2027-02-30" }).expiresOn).toBeNull();
    expect(cleanLicenceAnswer({ ...read, expiresOn: "1975-01-01" }).expiresOn).toBeNull();
    expect(cleanLicenceAnswer({ ...read, issuedOn: "2028-01-01" }).issuedOn).toBeNull();
  });

  it("keeps a number that is not an FSSAI number as printed, cut to the form's length", () => {
    expect(cleanLicenceAnswer({ ...read, number: "FIRE/HYD/2026/00871" }).number).toBe("FIRE/HYD/2026/00871");
    expect(cleanLicenceAnswer({ ...read, number: "X".repeat(80) }).number).toHaveLength(60);
    expect(cleanLicenceAnswer({ ...read, number: "   " }).number).toBeNull();
  });
});

describe("stored translations", () => {
  it("say what a reader sees: the translation, nothing to translate, or not translated yet", () => {
    const stored = { source: "en" as const, to: { te: "ఫ్రిజ్ శుభ్రం చేయండి" } };
    expect(storedTranslationFor(stored, "te")).toEqual({ text: "ఫ్రిజ్ శుభ్రం చేయండి", from: "en" });
    expect(storedTranslationFor(stored, "en")).toBeNull();
    expect(storedTranslationFor(stored, "hi")).toBe("missing");
    expect(storedTranslationFor(null, "hi")).toBe("missing");
  });
});

describe("filling in missing languages", () => {
  it("lists the languages a text does not have, a blank one counting as missing", () => {
    expect(missingLanguages({ en: "Check for water leaks." })).toEqual(AI_LANGUAGES.filter((language) => language !== "en"));
    expect(missingLanguages({ en: "Check", te: "   " })).toContain("te");
    expect(missingLanguages(null)).toEqual([...AI_LANGUAGES]);
    expect(missingLanguages(Object.fromEntries(AI_LANGUAGES.map((language) => [language, "x"])))).toEqual([]);
  });

  it("adds only the missing languages, and never changes one that is there", () => {
    const stored = { en: "Cash drawer counted", te: "క్యాష్ డ్రాయర్ లెక్కించారు" };
    const filled = { en: "A different English", te: "వేరే", hi: " कैश ड्रॉअर गिना गया ", ta: "" };
    expect(addMissingLanguages(stored, filled)).toEqual({ en: "Cash drawer counted", te: "క్యాష్ డ్రాయర్ లెక్కించారు", hi: "कैश ड्रॉअर गिना गया" });
    // The stored text itself is left as it was.
    expect(stored).toEqual({ en: "Cash drawer counted", te: "క్యాష్ డ్రాయర్ లెక్కించారు" });
  });

  it("says when there was nothing to add", () => {
    expect(addMissingLanguages({ en: "Cash drawer counted" }, { en: "Something else" })).toBeNull();
    expect(addMissingLanguages({ en: "Cash drawer counted" }, {})).toBeNull();
  });
});

describe("knowing the language from the script", () => {
  it("is sure only for scripts one language uses", () => {
    expect(writtenInOwnScript("ఫ్రిజ్ శుభ్రం చేయండి", "te")).toBe(true);
    expect(writtenInOwnScript("ఫ్రిజ్ 4°C శుభ్రం చేయండి", "te")).toBe(true);
    // Half English, half Telugu: not sure, so it is asked.
    expect(writtenInOwnScript("Fridge cleaned ఫ్రిజ్ శుభ్రం", "te")).toBe(false);
    expect(writtenInOwnScript("ఫ్రిజ్ శుభ్రం", "ta")).toBe(false);
    // Devanagari is Hindi or Marathi, and English letters may be Hindi typed in English: always asked.
    expect(writtenInOwnScript("फ्रिज साफ करें", "hi")).toBe(false);
    expect(writtenInOwnScript("Clean the fridge", "en")).toBe(false);
    expect(writtenInOwnScript("12345", "te")).toBe(false);
  });

  it("leaves numbers and single marks alone", () => {
    expect(hasWords("OK thanks")).toBe(true);
    expect(hasWords("👍")).toBe(false);
    expect(hasWords("10:30")).toBe(false);
    expect(hasWords("ఫ్రిజ్")).toBe(true);
  });
});

describe("the answer shapes of the digest, the inspection write-up and the camera nudge", () => {
  it("are strict JSON schemas whose properties match the Zod checks", () => {
    for (const [json, zod] of [
      [MONITORING_DIGEST_JSON_SCHEMA, monitoringDigestSchema],
      [INSPECTION_SUMMARY_JSON_SCHEMA, inspectionSummaryAnswerSchema],
      [PHOTO_CHECK_JSON_SCHEMA, photoCheckSchema],
    ] as const) {
      expect(json.additionalProperties).toBe(false);
      expect([...(json.required as string[])].sort()).toEqual(Object.keys(zod.shape).sort());
      expect(Object.keys(json.properties as object).sort()).toEqual(Object.keys(zod.shape).sort());
    }
    const point = ((MONITORING_DIGEST_JSON_SCHEMA.properties as Record<string, AiJsonSchema>).points!.items as AiJsonSchema);
    expect(point).toMatchObject({ required: ["outletId", "text"], additionalProperties: false });
    expect((PHOTO_CHECK_JSON_SCHEMA.properties as Record<string, { enum: string[] }>).verdict!.enum).toEqual([...PHOTO_CHECK_VERDICTS]);
  });

  it("need a line on the day, and points that name an outlet", () => {
    expect(monitoringDigestSchema.safeParse({ overview: "Two outlets need attention.", points: [{ outletId: "o1", text: "Licence expired." }] }).success).toBe(true);
    expect(monitoringDigestSchema.safeParse({ overview: "", points: [] }).success).toBe(false);
    expect(monitoringDigestSchema.safeParse({ overview: "Fine.", points: [{ text: "No outlet" }] }).success).toBe(false);
  });

  it("need a summary, and let a few too many findings through to be cut afterwards", () => {
    expect(inspectionSummaryAnswerSchema.safeParse({ summary: "Good overall.", fixFirst: [] }).success).toBe(true);
    expect(inspectionSummaryAnswerSchema.safeParse({ summary: "Good overall.", fixFirst: ["a", "b", "c", "d", "e", "f"] }).success).toBe(true);
    expect(inspectionSummaryAnswerSchema.safeParse({ summary: " ", fixFirst: [] }).success).toBe(false);
  });

  it("accept only the six photo verdicts, each with a reason or null", () => {
    expect(PHOTO_CHECK_VERDICTS).toEqual(["OK", "BLURRED", "TOO_DARK", "WRONG_SUBJECT", "NOT_DONE", "UNSURE"]);
    expect(photoCheckSchema.safeParse({ verdict: "BLURRED", reason: null }).success).toBe(true);
    expect(photoCheckSchema.safeParse({ verdict: "NOT_DONE", reason: "Two bottles still have water in them." }).success).toBe(true);
    expect(photoCheckSchema.safeParse({ verdict: "DIRTY", reason: null }).success).toBe(false);
    // The reason is always there in the answer's shape, even when it is null.
    expect(photoCheckSchema.safeParse({ verdict: "OK" }).success).toBe(false);
    // A reason far longer than about 12 words is refused, so nothing is shown.
    expect(photoCheckSchema.safeParse({ verdict: "NOT_DONE", reason: "water ".repeat(60) }).success).toBe(false);
    expect((PHOTO_CHECK_JSON_SCHEMA.properties as Record<string, object>).reason).toEqual({ type: ["string", "null"] });
  });
});

describe("the camera nudge", () => {
  it("shows only for a photo that is clearly unusable, and treats unsure as fine", () => {
    expect(photoNudgeFor({ verdict: "BLURRED", reason: null })).toEqual({ nudge: "BLURRED", reason: null });
    expect(photoNudgeFor({ verdict: "TOO_DARK", reason: null })).toEqual({ nudge: "TOO_DARK", reason: null });
    expect(photoNudgeFor({ verdict: "WRONG_SUBJECT", reason: null })).toEqual({ nudge: "WRONG_SUBJECT", reason: null });
    expect(photoNudgeFor({ verdict: "OK", reason: null })).toEqual({ nudge: null, reason: null });
    expect(photoNudgeFor({ verdict: "UNSURE", reason: null })).toEqual({ nudge: null, reason: null });
  });

  it("says what looks not done, in the AI's words, tidied", () => {
    expect(photoNudgeFor({ verdict: "NOT_DONE", reason: "  Two bottles still\nhave water in them. " })).toEqual({
      nudge: "NOT_DONE",
      reason: "Two bottles still have water in them.",
    });
    expect(photoNudgeFor({ verdict: "NOT_DONE", reason: "రెండు సీసాల్లో ఇంకా నీళ్లు ఉన్నాయి." })).toEqual({
      nudge: "NOT_DONE",
      reason: "రెండు సీసాల్లో ఇంకా నీళ్లు ఉన్నాయి.",
    });
  });

  it("shows nothing for NOT_DONE without a reason: there is nothing to say", () => {
    expect(photoNudgeFor({ verdict: "NOT_DONE", reason: null })).toEqual({ nudge: null, reason: null });
    expect(photoNudgeFor({ verdict: "NOT_DONE", reason: "   " })).toEqual({ nudge: null, reason: null });
  });

  it("never passes on a reason with another verdict", () => {
    expect(photoNudgeFor({ verdict: "OK", reason: "Looks clean." })).toEqual({ nudge: null, reason: null });
    expect(photoNudgeFor({ verdict: "BLURRED", reason: "Shaken." })).toEqual({ nudge: "BLURRED", reason: null });
  });
});

describe("checking the ids in an answer", () => {
  it("names any id the app did not give", () => {
    expect(unknownIds(["a", "b"], ["a", "b", "c"])).toEqual([]);
    expect(unknownIds(["a", "made-up"], new Set(["a"]))).toEqual(["made-up"]);
    expect(unknownIds([], [])).toEqual([]);
  });

  it("keeps the first few, each once, in order", () => {
    expect(firstDistinct(["b", "a", "b", "c", "d"], 3)).toEqual(["b", "a", "c"]);
    expect(firstDistinct([], 5)).toEqual([]);
  });
});

describe("checking the numbers in an explanation", () => {
  it("reads Indian digits as ordinary ones", () => {
    expect(westernDigits("स्कोर ७२ है")).toBe("स्कोर 72 है");
    expect(westernDigits("స్కోరు ౭౨")).toBe("స్కోరు 72");
    expect(westernDigits("۷۲")).toBe("72");
  });

  it("finds whole and decimal numbers", () => {
    expect(numbersIn("72 out of 100, 16.8 points; 7,5 more")).toEqual([72, 100, 16.8, 7.5]);
    expect(numbersIn("no numbers here")).toEqual([]);
  });

  it("names any number that the app did not give", () => {
    const allowed = [72, 100, 60, 43.2, 16.8, 1, 3];
    expect(unknownNumbers("Your score is 72 out of 100. The inspection cost 16.8 points.", allowed)).toEqual([]);
    expect(unknownNumbers("Your score is 72; fixing this adds 15 points.", allowed)).toEqual([15]);
    expect(unknownNumbers("स्कोर ७२ है, ४२ नहीं", allowed)).toEqual([42]);
  });

  it("finds a digit in any script, for answers that must have none", () => {
    expect(hasDigit("Checklists not handed in today cost the most.")).toBe(false);
    expect(hasDigit("ఈ రోజు చెక్‌లిస్ట్‌లు ఇవ్వలేదు.")).toBe(false);
    expect(hasDigit("Only 1 checklist was handed in.")).toBe(true);
    expect(hasDigit("स्कोर ७२ है")).toBe(true);
    expect(hasDigit("స్కోరు ౧౩")).toBe(true);
    expect(hasDigit("۱۳ پوائنٹس")).toBe(true);
    expect(hasDigit("১৩")).toBe(true);
  });

  it("finds a count written in words, for English answers whose numbers are checked", () => {
    expect(hasNumberWord("Six sections scored 100.")).toBe(true);
    expect(hasNumberWord("Twenty-one checks were not applicable.")).toBe(true);
    expect(hasNumberWord("5 sections scored 100; no one check failed.")).toBe(false);
    expect(hasNumberWord("Both the hood and the drain need cleaning.")).toBe(false);
    expect(hasNumberWord("The kitchen often missed its closing checklist.")).toBe(false);
  });
});
