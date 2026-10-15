# CookFlow Ingest — Spec

## 0. Context

[CookFlow](https://github.com/moneychien19/CookFlow) plans several meals at once around what's already in a cook's pantry. Its planner needs every recipe in one shape: each ingredient line mapped to a canonical ingredient with a quantity in that ingredient's single unit.

This repo gets recipes from external sources into CookFlow's Postgres database in that shape. It fetches recipes, maps each ingredient line to a canonical ingredient and quantity, has a person review the result, and loads the approved recipes into the database.

- **CookFlow's database schema is the source of truth.** This repo writes data in that format. It never creates or changes tables or migrations.
- **The first source is [TheMealDB](https://www.themealdb.com/api.php).** Other sources come later. Each one plugs in as an adapter (§4).

---

## 1. Scope

### In
| # | Feature |
|---|---|
| 1 | Fetch about 100 recipes from TheMealDB and cache the raw responses |
| 2 | Map ingredient lines with rules first (fractions, counts, weights, volumes) |
| 3 | Send the lines the rules can't map to Claude, offline, for a proposed mapping |
| 4 | Hand review: each recipe is approved or dropped in a reviewed file |
| 5 | Load approved recipes into the database: idempotent, one transaction |
| 6 | Reports: unmapped lines, dropped recipes and why, counts per stage |
| 7 | CI: typecheck, lint, test |

### Out (for now)
- Sources other than TheMealDB. The adapter boundary exists so one can be added later (§4).
- Detecting schema drift between this repo and CookFlow's migrations. The table definitions here are written by hand to match CookFlow's schema (§3).
- Scheduled or continuous ingestion. Each run is started by hand.
- Deleting or updating recipes that are no longer in the reviewed file.
- Re-hosting images, nutrition data, or any recipe field the CookFlow schema doesn't have.
- Rewriting, summarizing, or translating recipe text.

---

## 2. Stack

- **TypeScript** (strict, `noUncheckedIndexedAccess`) on Node 22, run with `tsx`
- **zod** at every boundary: API responses, data files, CLI arguments
- **Drizzle ORM** with Neon's WebSocket `Pool` driver, which supports interactive transactions
- **Anthropic SDK** for the offline normalization step
- **Vitest**
- **GitHub Actions**: typecheck, lint, test on every push

---

## 3. Target: CookFlow's tables

This repo writes three tables. The definitions below match CookFlow's migrations up to `0001_gram_units`.

```
ingredients
  id            serial pk
  name          text unique          -- canonical, lowercase: "onion", "chicken breast"
  unit          text                 -- CHECK in ('whole','pack','bunch','clove','count','g','ml')
  is_staple     boolean default false

recipes
  id            serial pk
  title         text
  source        text                 -- "themealdb"
  source_id     text                 -- unique (source, source_id)
  image_url     text null
  instructions  text
  servings      int null
  tags          text[] default '{}'

recipe_ingredients
  recipe_id      fk recipes (on delete cascade)
  ingredient_id  fk ingredients
  quantity       numeric(8,2) > 0    -- in ingredients.unit
  source_name    text                -- exactly as the source wrote it
  source_measure text                -- exactly as the source wrote it
  primary key (recipe_id, ingredient_id)
```

The tables are defined by hand in `src/db/schema.ts`. Keeping them in sync with CookFlow is out of scope for now (§1).

### Rules every loaded recipe follows
1. **Verbatim source text.** `title`, `source_name`, and `source_measure` are stored exactly as the source gives them: no trimming, no rewording, no truncation. `instructions` are stored as numbered steps (`1. …\n2. …`, one step per line), or exactly as the source gives them until they are split. The steps keep every word of the source in order; only the source's own step labels (`step 1`, `1.`, ...) and line breaks may change. Instructions include the food-safety steps (CookFlow SPEC §7a #9, #10).
2. **One canonical unit per ingredient.** The unit follows how the food is measured:
   - Produce, herbs, and eggs are counted (`whole`, `bunch`, `count`). Garlic is in `clove`.
   - Meat, fish, cheese, and dry goods (rice, pasta) are in `g`.
   - Milk and cream are in `ml`.

   Each measure is converted once, here, into the ingredient's unit: "2 chicken breasts" → 400 g. CookFlow never converts at runtime.
3. **Quantities fit `numeric(8,2)`:** greater than 0, at most 999999.99, and at most 2 decimals. The data is validated before loading, so the database never rounds a value silently.
4. **Each canonical ingredient appears at most once per recipe**, because of the primary key (§5.4).
5. **Staples** (salt, black pepper, olive oil, vegetable oil, water, sugar, ...) are flagged `is_staple`. They're still loaded as recipe lines.
6. **A recipe that can't be mapped cleanly is dropped**, never force-mapped. 50 good recipes are better than 100 noisy ones.

---

## 4. Pipeline

```
fetch ──▶ raw cache ──▶ map (rules) ──▶ normalize (Claude) ──▶ steps (Claude) ──▶ review (person) ──▶ load
          data/<source>/raw/             data/<source>/recipes.json                   DATABASE_URL
```

| Stage | Command | Reads | Writes |
|---|---|---|---|
| Fetch | `npm run ingest:fetch -- <source>` | the source's API | `data/<source>/raw/*.json` |
| Map | `npm run ingest:map -- <source>` | raw cache, ingredient catalog | `data/<source>/recipes.json`, unmapped report |
| Normalize | `npm run ingest:normalize -- <source>` | `recipes.json` | the same file, with proposed mappings for unmapped lines |
| Steps | `npm run ingest:steps -- <source>` | `recipes.json`, raw cache | the same file, with instructions split into numbered steps |
| Review | edit `data/<source>/recipes.json` by hand | — | the same file, each recipe `approved` or `dropped` |
| Load | `npm run ingest:load -- <source> [--dry-run]` | approved recipes, ingredient catalog | the database |

Each stage after fetch runs offline from files in the repo, so a run can be reproduced without calling the source again. Raw caches and reviewed files are committed.

### Source adapters
Each source supplies only what's specific to it:
- `fetch()`: download and cache raw records, validating each response with zod
- `toSourceRecipe(raw)`: return a common shape `{ sourceId, title, instructions, imageUrl, servings, tags, lines: [{ name, measure }] }`

Mapping, normalization, review, validation, and loading are shared by all sources.

---

## 5. Details

### 5.1 TheMealDB adapter
- Use the free API (`https://www.themealdb.com/api/json/v1/1/`): `search.php?f=<letter>`, from `a` to `z`. It returns whole meals, so `lookup.php` isn't needed. Send requests one at a time with a short delay.
- Skip meals in the `Dessert` category: CookFlow plans meals around the fridge. They aren't cached and don't count toward `--limit`.
- `source = "themealdb"`, `sourceId = idMeal`, `title = strMeal`, `instructions = strInstructions`, `imageUrl = strMealThumb`, `servings = null` (TheMealDB doesn't give servings).
- Lines come from `strIngredient1..20` and `strMeasure1..20`. Skip a pair when the ingredient is `null` or blank. Otherwise keep both strings verbatim.
- Tags: `strCategory` and `strTags` (comma-separated), lowercased. Add `vegetarian` when the category is `Vegetarian` or `Vegan`. CookFlow's dietary filter reads only `vegetarian`.

### 5.2 Ingredient catalog
`data/ingredients.json` lists the canonical ingredients this repo maps to: `{ name, unit, isStaple, aliases[], reviewed, note }`. Aliases are lowercased source names that mean this ingredient, for example `"red onion"` → `onion`. Every name and alias belongs to exactly one entry.

The catalog is drafted from TheMealDB's ingredient list (`list.php?i=list`, about 990 names), not from CookFlow's seed ingredients. `npm run catalog:bootstrap` asks Claude, in batches, for each name's canonical ingredient, unit (§3 rule 2), and staple flag, then groups the names by canonical ingredient. Every drafted entry starts `reviewed: false`, with a `note` where Claude was unsure or the proposals disagreed. Claude's proposals are saved in `data/catalog/bootstrap-proposals.json`, so a rerun only asks about names that don't have one, and it never changes an entry with `reviewed: true`.

Source names are never stored as ingredients directly. Every line maps to a catalog entry first, and only reviewed entries can be used by an approved recipe or loaded, so spellings like `Onion`, `onions`, and `Red Onion` don't become separate ingredients that the planner can't match against the pantry. A person reviews only the entries that recipes actually use.

When loading:
- **A missing ingredient is inserted only if an approved recipe uses it.** Catalog entries that no approved recipe uses aren't loaded.
- **An existing ingredient is never modified.** If its `unit` or `is_staple` in the database differs from the catalog, the load fails. Quantities computed for one unit would be wrong in another: 1 pack of chicken loaded as 1 g.

### 5.3 Rule-based mapping
1. **Ingredient:** look up the lowercased, trimmed source name against catalog names and aliases. If nothing matches, the line is unmapped.
2. **Measure:** parse integers, decimals, fractions (`1/2`), mixed numbers (`1 1/2`), and unicode fractions (`½`). Then convert by the ingredient's unit:
   - Counted units: a bare number or a matching count word ("2", "2 cloves", "1 bunch", a lone "bunch") maps directly. "Juice of 1" and "zest of ½" map to that many `whole` lemons or limes.
   - `g`: `g`, `kg`, `oz`, and `lb` convert to grams.
   - `ml`: `ml`, `l`, `tsp`, `tbsp`, and `cup` convert to millilitres. A cup is 240 ml.
   - Preparation and size words that don't change the amount are allowed after the number or unit ("1 chopped", "2 large", "1 clove peeled crushed", "1kg cut into cubes"). Any other word makes the line unmapped.
   - Anything else is unmapped: a count for a weighed ingredient ("2 chicken breasts"), a volume for a weighed one ("1 cup rice"), a range or multiple ("4-5 pound", "2 x 400g"), or vague text ("a handful", "to taste").
3. A staple whose measure doesn't convert ("to taste", "pinch", or "1 tsp" for a staple weighed in `g`) maps to a nominal quantity of `1` in the staple's unit, marked as nominal. The planner ignores staples, so the exact value doesn't matter.
4. Round mapped quantities to 2 decimals.

### 5.4 Duplicate ingredients in one recipe
When two lines map to the same canonical ingredient, the recipe can't be stored as-is, because of the primary key. For now, the recipe is **dropped**, with the reason `duplicate ingredient "<name>"`. See the open questions (§8).

### 5.5 Normalization with Claude
- Only unmapped lines (no quantity, no `method`) of `pending` recipes are sent, one request per recipe. Claude gets the whole recipe for context, the lines to answer, and the ingredient catalog. It returns one of:
  - an existing canonical ingredient and a quantity in that ingredient's unit. A line whose name already matched keeps its ingredient; Claude only works out the quantity.
  - a proposed new ingredient (`name`, `unit`, `isStaple`) and a quantity, only when nothing in the catalog fits
  - "can't map"
- Responses are validated with zod and checked against the catalog. Each answer records `method: "claude"` and a short `note` with Claude's reasoning, for the reviewer. "Can't map" is recorded too (quantity stays null), so it isn't asked again. An answer that breaks a rule is discarded and the line is asked again on the next run.
- A proposed new ingredient joins the catalog as an unreviewed draft (and `bootstrap-proposals.json`, so rebuilding the catalog keeps it). Like every draft, it must be reviewed before an approved recipe can use it (§5.2).
- This step runs only from the CLI, offline. Nothing calls Claude when CookFlow runs.

### 5.5b Numbered steps
- Source instructions come in many shapes: paragraphs, `step 1` headers, `1.` lists (some starting at 0, some hard-wrapped mid-sentence), headings, and notes. CookFlow shows them as numbered steps.
- `ingest:steps` sends the instructions of each `pending` or `approved` recipe that isn't numbered steps yet to Claude, one request per recipe. Claude returns a list of steps; code numbers them and stores `1. …\n2. …`.
- Code checks every answer against the raw cache: the steps must keep every word of the original, in order, with the same spelling and punctuation. Only the source's step labels may be dropped: `step N` headers (with a following `-` or `:`), `N.` / `N)` at the start of a line, and bare line-start numbers that count up from 1 (at least two of them, so "1 tomato" stays). An answer that fails keeps the original text, and the recipe is asked again on the next run.
- Map keeps numbered steps when it remaps a pending recipe, as long as they still keep every word of the raw cache.

### 5.6 Reviewed file
`data/<source>/recipes.json`:

```jsonc
[
  {
    "source": "themealdb",
    "sourceId": "52772",
    "title": "Teriyaki Chicken Casserole",
    "imageUrl": "https://www.themealdb.com/images/media/meals/....jpg",
    "instructions": "…verbatim…",
    "servings": null,
    "tags": ["chicken", "meat", "casserole"],
    "status": "pending",            // "pending" | "approved" | "dropped"
    "dropReason": null,
    "lines": [
      {
        "sourceName": "soy sauce",
        "sourceMeasure": "3/4 cup",
        "ingredient": "soy sauce",  // canonical name, or null if unmapped
        "quantity": 180,            // in the ingredient's unit, or null
        "method": "rule",           // "rule" | "claude" | "manual" | null
        "note": null
      }
    ]
  }
]
```

- Map and normalize regenerate only `pending` recipes. They never overwrite a recipe that is `approved` or that a reviewer `dropped`, so review work survives reruns.
- Within a `pending` recipe, map keeps lines with `method: "claude"` or `"manual"` and maps every other line again, so catalog changes reach pending recipes without losing Claude's proposals or a reviewer's fixes.
- A recipe that map itself dropped (`duplicate ingredient "<name>"`, §5.4) is checked again on every run, so a catalog change can bring it back.
- A line whose name matches a catalog entry but whose measure doesn't convert keeps `ingredient`, with `quantity: null` and the reason in `note`.
- The reviewer fixes lines (and sets `method: "manual"` on lines they change), then sets `status`.
- An `approved` recipe must pass validation:
  - every line has a reviewed catalog ingredient and a valid quantity
  - no ingredient appears twice
  - `instructions` is byte-identical to the raw cache, or numbered steps that keep every word of it (§3 rule 1, §5.5b)

### 5.7 Load
- Load all approved recipes for a source in **one transaction**. Any failure rolls the whole load back.
- Insert catalog ingredients that approved recipes use and the database doesn't have yet (§5.2).
- Upsert recipes on `(source, source_id)`.
- Replace `recipe_ingredients` for each loaded recipe.
- Don't touch rows from other sources, or recipes that aren't in the file.
- Running the load twice leaves the same row counts.
- `--dry-run` validates and prints what would be inserted and updated, without writing.
- Before writing, print the target database host and the counts.

---

## 6. Data quality targets

- At least **50 approved** TheMealDB recipes, at least **10** of them vegetarian.
- Every approved recipe passes §3 rules 1–6 and §5.6 validation.
- Spot-check: 10 random approved recipes compared by hand against TheMealDB.

---

## 7. Tests (Vitest)

- Measure parser: integers, decimals, fractions, mixed numbers, unicode fractions, and unit conversions (oz → g, tbsp → ml, ...). Unparseable text returns "unmapped", not a guess.
- Ingredient matching by name and alias. An unknown name is unmapped.
- TheMealDB adapter: blank and `null` pairs are skipped, strings are kept verbatim (including surrounding whitespace), and the `vegetarian` tag comes from the category.
- Duplicate canonical ingredients drop the recipe with a reason.
- Validation rejects approved recipes with a missing quantity, more than 2 decimals, an unknown ingredient, or instructions that differ from the raw cache by more than the step numbering.
- Numbered steps: accepted when they only re-split the text and drop the source's step labels; rejected when a word is added, dropped, changed, or reordered.
- Rerunning map doesn't overwrite approved or dropped recipes.
- Load (`*.db.test.ts`, against `TEST_DATABASE_URL`, skipped when it's unset):
  - running the load twice gives the same counts
  - a unit conflict with an existing ingredient fails, with nothing written
  - a catalog ingredient that no approved recipe uses isn't inserted
  - rows from other sources are untouched

---

## 8. Open questions

1. ~~**Duplicate ingredients in one recipe**~~ (§5.4). Decided: keep dropping the recipe, and fetch about 200 recipes instead of 100 to make up for it (multi-part recipes often list an ingredient twice: 2 of the first 5 meals). Revisit with the full numbers if too few recipes are left; merging the lines (joining the source measures with " + ") is the fallback.
2. ~~**Categories to skip.**~~ Decided: `Dessert` is skipped at fetch time (§5.1). `Breakfast` is kept.
3. **Who owns the `ingredients` table.** CookFlow's `db:seed` upserts ingredients and overwrites their `unit` on conflict, and this repo inserts ingredients too. Decide whether CookFlow's seeder keeps writing ingredients once real recipes come from here.
