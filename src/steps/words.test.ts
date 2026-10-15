import { describe, expect, it } from "vitest";
import { formatSteps, isNumberedSteps, keepsEveryWord, wordProblem } from "./words";

describe("formatSteps / isNumberedSteps", () => {
  it("numbers steps one per line", () => {
    expect(formatSteps(["Chop the onion.", "Fry it."])).toBe("1. Chop the onion.\n2. Fry it.");
  });

  it.each([
    ["1. Chop.\n2. Fry.", true],
    ["1. Chop.", true],
    ["1. Chop.\r\n2. Fry.", false],
    ["1. Chop.\n3. Fry.", false],
    ["0. Chop.\n1. Fry.", false],
    ["1. Chop.\n\n2. Fry.", false],
    ["1. Chop. \n2. Fry.", false],
    ["Chop.\nFry.", false],
    ["", false],
  ])("%j → %s", (text, expected) => {
    expect(isNumberedSteps(text)).toBe(expected);
  });
});

describe("keepsEveryWord", () => {
  it("accepts the original text unchanged", () => {
    expect(keepsEveryWord("Chop.\r\n\r\nFry. ", "Chop.\r\n\r\nFry. ")).toBe(true);
  });

  it.each([
    ["paragraphs", "Chop the onion.\r\nFry it.\r\n\r\nServe.", ["Chop the onion.", "Fry it.", "Serve."]],
    ["one paragraph split by sentence", "Chop the onion. Fry it. Serve.", ["Chop the onion. Fry it.", "Serve."]],
    ["lines hard-wrapped mid-sentence", "Rinse the eggplant and\r\nroast it.\r\n2. Peel it.", ["Rinse the eggplant and roast it.", "Peel it."]],
    ["step headers", "step 1\r\nChop.\r\n\r\nstep 2\r\nFry.", ["Chop.", "Fry."]],
    ["STEP N - TITLE headers", "STEP 1 - MARINATE\r\nMix.\r\nSTEP 2: FRY\r\nFry.", ["MARINATE Mix.", "FRY Fry."]],
    ["numbering from 0", "0.\tMarinate.\r\n1.\tFry.", ["Marinate.", "Fry."]],
    ["bare numbers counting up", "1 Prepare: score.\r\n2 Sear: brown it.", ["Prepare: score.", "Sear: brown it."]],
    ["bare numbers on their own lines", "1\r\nChop.\r\n2\r\nFry.", ["Chop.", "Fry."]],
    ["bare numbers from 2 after an unnumbered first step", "Soak.\r\n2\r\nChop.\r\n3\r\nFry.", ["Soak.", "Chop.", "Fry."]],
    ["a heading merged into its step", "Prepare the chicken:\r\nCut it.", ["Prepare the chicken: Cut it."]],
    ["soft hyphens", "Mix the onion\u00adtomato masala.", ["Mix the oniontomato masala."]],
  ])("accepts %s", (_, original, steps) => {
    expect(keepsEveryWord(original, formatSteps(steps))).toBe(true);
  });

  it.each([
    ["a dropped word", "Cook for 20 minutes until done.", ["Cook for 20 minutes."]],
    ["an added word", "Cook it.", ["Cook it well."]],
    ["a changed word", "Cook until 75C.", ["Cook until 165F."]],
    ["reordered steps", "Chop.\r\nFry.", ["Fry.", "Chop."]],
    ["a fixed typo", "Cook untill done.", ["Cook until done."]],
    ["added punctuation", "Add salt pepper", ["Add salt, pepper"]],
    ["a dropped amount at the start of a line", "Stir in:\r\n6 eggs, beaten", ["Stir in: eggs, beaten"]],
    ["a lone 1 that is an amount", "Blend:\r\n1 tomato\r\n1 onion", ["Blend: tomato onion"]],
    ["a lone 2 that is an amount", "Stir in:\r\n2 eggs\r\nMix.", ["Stir in: eggs", "Mix."]],
    ["a dropped number mid-line", "Bake at 200C. 2. Rest.", ["Bake at 200C.", "Rest."]],
    ["text that isn't numbered steps", "Chop.\r\nFry.", ["Chop.\nFry."]],
  ])("rejects %s", (_, original, steps) => {
    expect(keepsEveryWord(original, formatSteps(steps))).toBe(false);
  });
});

describe("wordProblem", () => {
  it("names the first missing word", () => {
    expect(wordProblem("Cook for 20 minutes until done.", "1. Cook for 20 minutes.")).toBe(
      'original word 4 "minutes" (in "Cook for 20 minutes until") is missing; the steps have "minutes." there',
    );
  });
});
