import type { Unit } from "@/schema/catalog";

/**
 * A measure converted into the ingredient's unit (SPEC §5.3 steps 2–4). `nominal` marks a
 * staple whose measure didn't convert and got the placeholder quantity 1 instead.
 */
export type MeasureResult = { ok: true; quantity: number; nominal: boolean } | { ok: false; reason: string };
export type MeasureTarget = { unit: Unit; isStaple: boolean };

const MAX_QUANTITY = 999999.99;

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

/** Grams per unit. */
const WEIGHT: Record<string, number> = {
  g: 1, gr: 1, gram: 1, grams: 1, gm: 1, gms: 1,
  kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.59, lbs: 453.59, pound: 453.59, pounds: 453.59,
};

/** Millilitres per unit. A cup is 240 ml (TheMealDB mixes US and metric cups; the difference is ~4%). */
const VOLUME: Record<string, number> = {
  ml: 1, millilitre: 1, millilitres: 1, milliliter: 1, milliliters: 1,
  l: 1000, litre: 1000, litres: 1000, liter: 1000, liters: 1000,
  tsp: 5, tsps: 5, teaspoon: 5, teaspoons: 5,
  tbsp: 15, tbsps: 15, tbs: 15, tbls: 15, tblsp: 15, tablespoon: 15, tablespoons: 15,
  cup: 240, cups: 240,
};

/** Words that name one of each counted unit. Anything else ("2 sprigs", "1 bag") isn't converted. */
const COUNT_WORDS: Partial<Record<Unit, string[]>> = {
  whole: ["whole", "piece", "pieces"],
  clove: ["clove", "cloves"],
  bunch: ["bunch", "bunches"],
  count: ["can", "cans", "tin", "tins", "jar", "jars", "slice", "slices", "piece", "pieces", "sheet", "sheets"],
  pack: ["pack", "packs", "packet", "packets", "package", "packages"],
};
const ALL_COUNT_WORDS = new Set(Object.values(COUNT_WORDS).flat());

/**
 * Preparation and size words that don't change the amount: "1 chopped", "2 large",
 * "1 clove peeled crushed", "1kg cut into cubes". Any other word makes the measure unmapped.
 */
const DESCRIPTORS = new Set([
  "chopped", "diced", "sliced", "minced", "crushed", "grated", "peeled", "beaten", "mashed",
  "halved", "quartered", "cubed", "cubes", "cut", "into", "shredded", "trimmed", "deseeded",
  "seeded", "pitted", "rinsed", "drained", "softened", "melted", "separated", "seperated",
  "finely", "thinly", "roughly", "coarsely", "lightly", "fresh", "free-range", "large",
  "medium", "small", "big", "whole", "and",
]);

/** Measures that give no amount at all. */
const VAGUE = /^(to taste|pinch|dash|splash|drizzle|handful|handfull|sprinkl|garnish|to serve|for |as required|as needed|knob|dusting|topping|to glaze|some|few)/;

const NUMBER = String.raw`(\d+(?:\.\d+)?|\.\d+)`;
const AMOUNT = new RegExp(String.raw`^(?:${NUMBER}\s+(\d+)\/(\d+)|(\d+)\/(\d+)|${NUMBER})`);

/** Converts a source measure into `target.unit`, or says why it can't. Never guesses. */
export function convertMeasure(measure: string, target: MeasureTarget): MeasureResult {
  const result = convert(measure, target.unit);
  if (result.ok || !target.isStaple) return result;
  // The planner ignores staples, so a placeholder is fine (SPEC §5.3 step 3).
  return { ok: true, quantity: 1, nominal: true };
}

function convert(measure: string, unit: Unit): MeasureResult {
  const text = normalize(measure);
  if (text === "") return unmapped("no quantity");
  if (VAGUE.test(text)) return unmapped(`no amount ("${text}")`);

  // "juice of 1/2", "zest and juice of 2": that many whole lemons or limes.
  const juice = /^(?:juice|zest|zest and juice|juice and zest) of (.+)$/.exec(text);
  if (juice) {
    if (unit !== "whole") return unmapped(`"${text}" only converts for whole fruit`);
    const fruit = parseAmount(juice[1] ?? "");
    return fruit.ok && fruit.rest === "" ? amount(fruit.value) : unmapped(`no number ("${text}")`);
  }
  // A lone count word means one: "bunch", "clove".
  if (COUNT_WORDS[unit]?.includes(text)) return amount(1);

  const parsed = parseAmount(text);
  if (!parsed.ok) return parsed;
  const { value, rest } = parsed;
  if (/^(-|to\s+\d|x\s|x\d|\*)/.test(rest)) return unmapped(`range or multiple ("${text}")`);

  const unitWord = /^([a-z]+)\b\.?\s*/.exec(rest);
  const word = unitWord?.[1] ?? "";
  if (word in WEIGHT || word in VOLUME) {
    const problem = checkDescriptors(rest.slice(unitWord?.[0].length ?? 0));
    if (problem) return problem;
    if (word in WEIGHT) {
      return unit === "g" ? amount(value * (WEIGHT[word] ?? 0)) : unmapped(`weight for an ingredient measured in ${unit}`);
    }
    return unit === "ml" ? amount(value * (VOLUME[word] ?? 0)) : unmapped(`volume for an ingredient measured in ${unit}`);
  }

  // A bare number, maybe with one count word and descriptors: "2", "2 cloves", "1 chopped".
  const words = rest.split(/[\s,()]+/).filter((w) => w !== "" && w !== "of");
  const countWords = words.filter((w) => ALL_COUNT_WORDS.has(w));
  const others = words.filter((w) => !ALL_COUNT_WORDS.has(w) && !DESCRIPTORS.has(w));
  if (others.length > 0) return unmapped(`unrecognized words ("${others.join(" ")}")`);
  if (unit === "g" || unit === "ml") return unmapped(`a count for an ingredient measured in ${unit}`);
  if (countWords.length > 1) return unmapped(`more than one count word ("${countWords.join(", ")}")`);
  const countWord = countWords[0];
  if (countWord !== undefined && !COUNT_WORDS[unit]?.includes(countWord)) {
    return unmapped(`"${countWord}" doesn't count ${unit}`);
  }
  return amount(value);
}

/** Lowercase, unicode fractions spelled out ("1½" → "1 1/2"), single spaces. */
function normalize(measure: string): string {
  let text = measure.toLowerCase();
  for (const [char, fraction] of Object.entries(UNICODE_FRACTIONS)) text = text.replaceAll(char, ` ${fraction}`);
  return text.replace(/\s+/g, " ").trim();
}

function parseAmount(text: string): { ok: true; value: number; rest: string } | { ok: false; reason: string } {
  const article = /^(a|an|one)\s+(.*)$/.exec(text);
  if (article) return { ok: true, value: 1, rest: article[2] ?? "" };
  const match = AMOUNT.exec(text);
  if (!match) return unmapped(`no number ("${text}")`);
  const [, whole, mixedNum, mixedDen, fracNum, fracDen, plain] = match;
  let value: number;
  if (whole !== undefined) value = Number(whole) + Number(mixedNum) / Number(mixedDen);
  else if (fracNum !== undefined) value = Number(fracNum) / Number(fracDen);
  else value = Number(plain);
  if (!Number.isFinite(value)) return unmapped(`no number ("${text}")`);
  return { ok: true, value, rest: text.slice(match[0].length).trim() };
}

/** After a weight or volume, only descriptors and the form it comes in ("200g piece", "400g can"). */
function checkDescriptors(rest: string): MeasureResult | null {
  const others = rest.split(/[\s,()]+/).filter((w) => w !== "" && !DESCRIPTORS.has(w) && !ALL_COUNT_WORDS.has(w));
  return others.length > 0 ? unmapped(`unrecognized words ("${others.join(" ")}")`) : null;
}

function amount(value: number): MeasureResult {
  const quantity = Math.round(value * 100) / 100;
  if (quantity <= 0) return unmapped("quantity rounds to 0");
  if (quantity > MAX_QUANTITY) return unmapped("quantity too large");
  return { ok: true, quantity, nominal: false };
}

function unmapped(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
