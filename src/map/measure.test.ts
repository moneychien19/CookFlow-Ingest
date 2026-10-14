import { describe, expect, it } from "vitest";
import type { Unit } from "@/schema/catalog";
import { convertMeasure } from "./measure";

const to = (unit: Unit, isStaple = false) => ({ unit, isStaple });

describe("convertMeasure: numbers", () => {
  it.each([
    ["2", 2],
    ["1.5", 1.5],
    [".5", 0.5],
    ["1/2", 0.5],
    ["1 1/2", 1.5],
    ["½", 0.5],
    ["1½", 1.5],
    ["1 ½", 1.5],
    ["¾", 0.75],
    ["1/3", 0.33],
  ])("%j → %d", (measure, quantity) => {
    expect(convertMeasure(measure, to("whole"))).toEqual({ ok: true, quantity, nominal: false });
  });
});

describe("convertMeasure: weights into g", () => {
  it.each([
    ["800g", 800],
    ["800 g", 800],
    ["800 grams", 800],
    ["1kg", 1000],
    ["1.5 kg", 1500],
    ["4 oz", 113.4],
    ["3 ounces", 85.05],
    ["1 lb", 453.59],
    ["2 lbs", 907.18],
    ["1½ pounds", 680.39],
    ["1kg cut into cubes", 1000],
    ["200g piece", 200],
    ["400g can", 400],
  ])("%j → %d g", (measure, quantity) => {
    expect(convertMeasure(measure, to("g"))).toEqual({ ok: true, quantity, nominal: false });
  });
});

describe("convertMeasure: volumes into ml", () => {
  it.each([
    ["100ml", 100],
    ["1 l", 1000],
    ["1 1/2 l", 1500],
    ["2 tsp", 10],
    ["1 teaspoon", 5],
    ["1/2 tsp", 2.5],
    ["1 tbsp", 15],
    ["2tbsp", 30],
    ["3 tbs", 45],
    ["2 tblsp", 30],
    ["2 Tablespoons", 30],
    ["2  tablespoons", 30],
    ["3/4 cup", 180],
    ["1 ½ cups", 360],
    ["1 tablespoon chopped", 15],
  ])("%j → %d ml", (measure, quantity) => {
    expect(convertMeasure(measure, to("ml"))).toEqual({ ok: true, quantity, nominal: false });
  });
});

describe("convertMeasure: counted units", () => {
  it.each([
    ["2", "whole", 2],
    ["1 chopped", "whole", 1],
    ["2 large", "whole", 2],
    ["3 Large", "whole", 3],
    ["1 small finely diced", "whole", 1],
    ["1/2", "whole", 0.5],
    ["juice of 1", "whole", 1],
    ["Zest and juice of 2", "whole", 2],
    ["Juice of 1/2", "whole", 0.5],
    ["juice of ½", "whole", 0.5],
    ["Bunch", "bunch", 1],
    ["clove", "clove", 1],
    ["2 cloves", "clove", 2],
    ["5 cloves", "clove", 5],
    ["1 clove peeled crushed", "clove", 1],
    ["2 chopped cloves", "clove", 2],
    ["1 bunch", "bunch", 1],
    ["a bunch", "bunch", 1],
    ["3 beaten", "count", 3],
    ["2 cans", "count", 2],
    ["4 slices", "count", 4],
    ["1 packet", "pack", 1],
  ] as const)("%j → %d %s", (measure, unit, quantity) => {
    expect(convertMeasure(measure, to(unit))).toEqual({ ok: true, quantity, nominal: false });
  });
});

describe("convertMeasure: unmapped, never guessed", () => {
  it.each([
    ["2", "g", "a count for an ingredient measured in g"], // "2 chicken breasts"
    ["2 large", "g", "a count for an ingredient measured in g"],
    ["1 cup", "g", "volume for an ingredient measured in g"], // "1 cup rice"
    ["1 tbsp", "whole", "volume for an ingredient measured in whole"],
    ["200g", "bunch", "weight for an ingredient measured in bunch"],
    ["200g", "ml", "weight for an ingredient measured in ml"],
    ["a handful", "g", 'unrecognized words ("handful")'],
    ["handful", "bunch", 'no amount ("handful")'],
    ["to taste", "g", 'no amount ("to taste")'],
    [" ", "ml", "no quantity"],
    ["", "whole", "no quantity"],
    ["4-5 pound", "g", 'range or multiple ("4-5 pound")'],
    ["2 x 400g", "g", 'range or multiple ("2 x 400g")'],
    ["1 sprig", "bunch", 'unrecognized words ("sprig")'],
    ["1 can", "whole", '"can" doesn\'t count whole'],
    ["2 cloves", "whole", '"cloves" doesn\'t count whole'],
    ["juice of 1", "ml", '"juice of 1" only converts for whole fruit'],
    ["juice of a few", "whole", 'no number ("juice of a few")'],
    ["bunch", "whole", 'no number ("bunch")'],
    ["1 can (400g)", "count", 'unrecognized words ("400g")'],
    ["4 Mashed", "g", "a count for an ingredient measured in g"],
    ["Dash", "ml", 'no amount ("dash")'],
    ["0", "whole", "quantity rounds to 0"],
    ["0.001", "whole", "quantity rounds to 0"],
    ["1000000 kg", "g", "quantity too large"],
  ] as const)("%j as %s: %s", (measure, unit, reason) => {
    expect(convertMeasure(measure, to(unit))).toEqual({ ok: false, reason });
  });
});

describe("convertMeasure: staples", () => {
  it("converts a staple's measure when it can", () => {
    expect(convertMeasure("2 tbsp", to("ml", true))).toEqual({ ok: true, quantity: 30, nominal: false });
  });

  it.each(["pinch", "to taste", "1 tsp", "Dash", "", "a pinch", "for frying"])(
    "gives a staple the nominal quantity 1 for %j",
    (measure) => {
      expect(convertMeasure(measure, to("g", true))).toEqual({ ok: true, quantity: 1, nominal: true });
    },
  );
});
