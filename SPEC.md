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
1. **Verbatim source text.** `title`, `instructions`, `source_name`, and `source_measure` are stored exactly as the source gives them: no trimming, no rewording, no truncation. Instructions include the food-safety steps (CookFlow SPEC §7a #9, #10).
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
fetch ──▶ raw cache ──▶ map (rules) ──▶ normalize (Claude) ──▶ review (person) ──▶ load
          data/<source>/raw/             data/<source>/recipes.json                   DATABASE_URL
```

| Stage | Command | Reads | Writes |
|---|---|---|---|
| Fetch | `npm run ingest:fetch -- <source>` | the source's API | `data/<source>/raw/*.json` |
| Map | `npm run ingest:map -- <source>` | raw cache, ingredient catalog | `data/<source>/recipes.json`, unmapped report |
| Normalize | `npm run ingest:normalize -- <source>` | `recipes.json` | the same file, with proposed mappings for unmapped lines |
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
- Use the free API (`https://www.themealdb.com/api/json/v1/1/`): `search.php?f=<letter>` to list meals and `lookup.php?i=<id>` for a single meal. Send requests one at a time with a short delay.
- `source = "themealdb"`, `sourceId = idMeal`, `title = strMeal`, `instructions = strInstructions`, `imageUrl = strMealThumb`, `servings = null` (TheMealDB doesn't give servings).
- Lines come from `strIngredient1..20` and `strMeasure1..20`. Skip a pair when the ingredient is `null` or blank. Otherwise keep both strings verbatim.
- Tags: `strCategory` and `strTags` (comma-separated), lowercased. Add `vegetarian` when the category is `Vegetarian` or `Vegan`. CookFlow's dietary filter reads only `vegetarian`.

### 5.2 Ingredient catalog
`data/ingredients.json` lists the canonical ingredients this repo maps to: `{ name, unit, isStaple, aliases[] }`. Aliases are lowercased source names that mean this ingredient, for example `"red onion"` → `onion`. The catalog starts from CookFlow's seed ingredients with the units in CookFlow SPEC §3. Chicken, beef, and rice are in `g`, not `pack`.

Source names are never stored as ingredients directly. Every line maps to a catalog entry first, and an entry joins the catalog only after review (§5.5), so spellings like `Onion`, `onions`, and `Red Onion` don't become separate ingredients that the planner can't match against the pantry.

When loading:
- **A missing ingredient is inserted only if an approved recipe uses it.** Catalog entries that no approved recipe uses aren't loaded.
- **An existing ingredient is never modified.** If its `unit` or `is_staple` in the database differs from the catalog, the load fails. Quantities computed for one unit would be wrong in another: 1 pack of chicken loaded as 1 g.

### 5.3 Rule-based mapping
1. **Ingredient:** look up the lowercased, trimmed source name against catalog names and aliases. If nothing matches, the line is unmapped.
2. **Measure:** parse integers, decimals, fractions (`1/2`), mixed numbers (`1 1/2`), and unicode fractions (`½`). Then convert by the ingredient's unit:
   - Counted units: a bare number or a matching count word ("2", "2 cloves", "1 bunch") maps directly.
   - `g`: `g`, `kg`, `oz`, and `lb` convert to grams.
   - `ml`: `ml`, `l`, `tsp`, `tbsp`, and `cup` convert to millilitres.
   - Anything else is unmapped: a count for a weighed ingredient ("2 chicken breasts"), a volume for a weighed one ("1 cup rice"), or vague text ("a handful", "to taste").
3. Staples with a vague measure ("to taste", "pinch") map to a nominal quantity of `1` in the staple's unit. The planner ignores staples, so the exact value doesn't matter.
4. Round mapped quantities to 2 decimals.

### 5.4 Duplicate ingredients in one recipe
When two lines map to the same canonical ingredient, the recipe can't be stored as-is, because of the primary key. For now, the recipe is **dropped**, with the reason `duplicate ingredient "<name>"`. See the open questions (§8).

### 5.5 Normalization with Claude
- Only unmapped lines are sent. Claude gets the source name and measure, the recipe title, and the ingredient catalog. It returns one of:
  - an existing canonical ingredient and a quantity in that ingredient's unit
  - a proposed new ingredient (`name`, `unit`, `isStaple`) and a quantity
  - "can't map"
- Responses are validated with zod. Each proposal records `method: "claude"` and a short `note` with Claude's reasoning, for the reviewer.
- A proposed new ingredient is added to the catalog only when the reviewer accepts it.
- This step runs only from the CLI, offline. Nothing calls Claude when CookFlow runs.

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

- Map and normalize regenerate only `pending` recipes. They never overwrite a recipe that is `approved` or `dropped`, so review work survives reruns.
- The reviewer fixes lines (and sets `method: "manual"` on lines they change), then sets `status`.
- An `approved` recipe must pass validation:
  - every line has a catalog ingredient and a valid quantity
  - no ingredient appears twice
  - `instructions` is byte-identical to the raw cache

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
- Validation rejects approved recipes with a missing quantity, more than 2 decimals, an unknown ingredient, or instructions that differ from the raw cache.
- Rerunning map doesn't overwrite approved or dropped recipes.
- Load (`*.db.test.ts`, against `TEST_DATABASE_URL`, skipped when it's unset):
  - running the load twice gives the same counts
  - a unit conflict with an existing ingredient fails, with nothing written
  - a catalog ingredient that no approved recipe uses isn't inserted
  - rows from other sources are untouched

---

## 8. Open questions

1. **Duplicate ingredients in one recipe** (§5.4). Dropping the recipe is the safe default. If it drops too many recipes, the alternatives are to merge the quantities (but then the source text in one row isn't verbatim), or to split canonical ingredients more finely.
2. **Categories to skip.** Should `Dessert` (and maybe `Breakfast`) be left out, since CookFlow plans meals around the fridge?
3. **Who owns the `ingredients` table.** CookFlow's `db:seed` upserts ingredients and overwrites their `unit` on conflict, and this repo inserts ingredients too. Decide whether CookFlow's seeder keeps writing ingredients once real recipes come from here.
