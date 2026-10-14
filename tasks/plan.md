# Implementation Plan: CookFlow Ingest (TheMealDB → CookFlow Postgres)

## Overview

Build the pipeline described in [SPEC.md](../SPEC.md): fetch ~100 TheMealDB recipes, map ingredient lines to a reviewed catalog with rules, send what's left to Claude offline, let a person approve or drop each recipe, and load approved recipes into CookFlow's database in one idempotent transaction. The repo is empty apart from the docs, so this plan starts from the scaffold.

## Architecture Decisions

- **Sources plug in through a `SourceAdapter` interface; TheMealDB is just the first implementation.** Nothing outside `src/sources/<name>/` knows TheMealDB exists. Every CLI takes `<source>`, looks the adapter up in a registry, and runs shared code. Adding a source means adding one folder and one registry line.

  ```ts
  // src/sources/types.ts
  interface SourceAdapter<Raw> {
    name: string;                        // written to recipes.source, used as data/<name>/
    rawSchema: z.ZodType<Raw>;           // validates API responses and cached files
    rawId(raw: Raw): string;             // becomes sourceId and the cache filename
    fetch(ctx: FetchContext): AsyncIterable<Raw>;  // source-specific paging, rate limiting
    toSourceRecipe(raw: Raw): SourceRecipe;        // pure, verbatim strings
  }
  interface FetchContext { limit: number; isCached(id: string): boolean; signal?: AbortSignal }
  ```

  The adapter only yields raw records. Validation, caching (`data/<source>/raw/<rawId>.json`), the limit, and skipping cached records are shared code in the fetch runner. Every later stage reads raw records through `rawSchema` + `toSourceRecipe`, including the "instructions byte-identical to raw cache" check, so no stage parses a source's raw format itself.
- **The interface is proven with a second, fake source.** A `fixture` adapter (in tests only) runs through fetch → map → validate → load-plan, so a TheMealDB-specific assumption leaking into shared code breaks a test.
- **Pure core, thin CLIs.** Parsing, matching, mapping, merging, and validation are pure functions over zod-typed data. Each `src/cli/<stage>.ts` only reads files, calls the core, and writes files. Almost everything can be unit tested without the network or a database.
- **One zod module owns every file format** (`src/schema/`): `SourceRecipe`, catalog entry, reviewed recipe/line, TheMealDB response. All stages read and write through it, so a malformed hand edit fails at read time with a path to the bad field.
- **Raw cache is one file per record** (`data/<source>/raw/<rawId>.json`, the record exactly as returned), for every source. That makes the "instructions byte-identical to raw cache" check a direct lookup. For TheMealDB, `search.php?f=<letter>` already returns full meals, so its `fetch` walks letters and only calls `lookup.php` if a search result is incomplete.
- **Deterministic JSON output.** Files are written with 2-space indent, a trailing newline, and recipes sorted by `sourceId`, so reruns produce clean git diffs.
- **Claude is behind an interface.** Normalize takes a `propose(line, context)` function; tests use a fake. The real one uses the Anthropic SDK with structured output validated by zod. Model ID comes from an env var with a default picked at implementation time.
- **DB access is isolated to `src/db/`** (hand-written Drizzle schema per SPEC §3, Neon WebSocket `Pool`). Load splits into a pure `planLoad(approved, catalog, dbSnapshot)` and a `applyLoad(tx, plan)`, so most load logic is unit-testable and `--dry-run` is just "plan and print".
- **No migrations, no drift checks** (SPEC §1 Out; deliberately deferred).

## Dependency Graph

```
T1 scaffold + CI
 └── T2 zod schemas + JSON I/O
      ├── T3 SourceAdapter interface + registry + fetch runner (fake source)
      │    ├── T4 TheMealDB adapter ───┬── T5b catalog bootstrap (Claude) ──┐
      │    └──────────────┐            │                                    │
      ├── T5 catalog schema + matcher ─┴──┐                                 │
      ├── T6 measure parser ──────────────┴── T7 map CLI ── T8 validation ──┼── T11 normalize ── T12 reports
      └── T9 DB schema + load dry-run ── T10 load write path ──────────────┘
                                                                             └── T13–T15 data + real load
```

T5b is the first real data and the first Claude call; T11 reuses its Claude client.

T7 and T8 depend on the interface (T3), not on TheMealDB (T4); they're tested with the fake source. T4 only matters for real data.

T9–T10 (database) only need T2 and a hand-written fixture, so they can run in parallel with T3–T7. They're the riskiest part (Neon interactive transactions, idempotency), so do them early rather than last.

---

## Task List

### Phase 1: Foundation

## Task 1: Project scaffold and CI

**Description:** Set up the TypeScript project so every later task has typecheck, lint, and test commands that already work, locally and in CI.

**Acceptance criteria:**
- [x] `package.json` with `typecheck`, `lint`, `test`, and the four `ingest:*` scripts (stubs that print usage); Node 22 pinned in `engines` and `.nvmrc`
- [x] `tsconfig.json` strict with `noUncheckedIndexedAccess`; ESLint flat config with typescript-eslint; Vitest config that runs `*.test.ts` and `*.db.test.ts`
- [x] `.env.example` (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `TEST_DATABASE_URL`), `.gitignore` (`.env.local`, `node_modules`), GitHub Actions workflow running typecheck, lint, test

**Verification:**
- [x] `npm run typecheck && npm run lint && npm test` passes on a trivial test
- [x] CI run is green on push

**Dependencies:** None

**Files likely touched:** `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.env.example`, `.gitignore`

**Estimated scope:** M

## Task 2: File-format schemas and JSON I/O

**Description:** Define zod schemas for every file and boundary (SPEC §4, §5.2, §5.6) and helpers to read/write them deterministically. This is the shared contract all stages use.

**Acceptance criteria:**
- [x] Schemas: `SourceRecipe`, `CatalogEntry` (`unit` limited to the 7 CHECK values), `ReviewedRecipe` / `ReviewedLine` (status, method enums, nullable fields as in §5.6)
- [x] `readJson(path, schema)` reports the failing path and field; `writeJson` sorts recipes by `sourceId` and writes 2-space JSON with a trailing newline
- [x] CLI arg parsing validated with zod (`<source>`, `--dry-run`, `--limit`); whether the source is registered is checked in T3, which owns the registry

**Verification:**
- [x] Tests: the §5.6 example parses; bad `status`, bad `unit`, and missing fields are rejected with a useful message
- [x] Round-trip read → write produces byte-identical output

**Dependencies:** T1

**Files likely touched:** `src/schema/*.ts`, `src/io/json.ts`, `src/cli/args.ts`, tests

**Estimated scope:** S–M

### Checkpoint: Foundation
- [ ] typecheck, lint, test green locally and in CI
- [ ] Schemas reviewed against SPEC §3/§5.6 (they're the contract for everything else)

---

### Phase 2: Database (high risk, do early)

## Task 9: DB schema, client, and `load --dry-run`

**Description:** Hand-write the three tables in Drizzle, connect through Neon's WebSocket `Pool`, and implement the pure `planLoad` plus `--dry-run`, which reads the DB and prints the target host and what would be inserted/updated without writing.

**Acceptance criteria:**
- [ ] `src/db/schema.ts` matches SPEC §3 (up to CookFlow migration `0001_gram_units`)
- [ ] `planLoad` computes: ingredients to insert (only reviewed entries used by approved recipes), unit/`is_staple` conflicts with existing rows (→ error), recipes to insert vs update, line counts
- [ ] `ingest:load -- themealdb --dry-run` prints DB host and counts, and writes nothing

**Verification:**
- [ ] Unit tests for `planLoad` with an in-memory DB snapshot (conflict, unused catalog entry, new vs existing recipe)
- [ ] Manual: dry-run against a Neon dev branch with a 1-recipe fixture file

**Dependencies:** T2

**Files likely touched:** `src/db/schema.ts`, `src/db/client.ts`, `src/load/plan.ts`, `src/cli/load.ts`, tests

**Estimated scope:** M

## Task 10: Load write path (one transaction, idempotent)

**Description:** Apply the plan inside one interactive transaction: insert missing ingredients, upsert recipes on `(source, source_id)`, replace `recipe_ingredients` per loaded recipe, and roll everything back on any failure.

**Acceptance criteria:**
- [ ] Loading twice leaves identical row counts and values
- [ ] An ingredient unit or `is_staple` conflict fails the load with nothing written
- [ ] Rows from other sources and recipes not in the file are untouched

**Verification:**
- [ ] `*.db.test.ts` against `TEST_DATABASE_URL` cover all four SPEC §7 load cases; skipped when unset
- [ ] Manual: load the fixture into a Neon dev branch twice, compare counts

**Dependencies:** T9

**Files likely touched:** `src/load/apply.ts`, `src/cli/load.ts`, `src/load/*.db.test.ts`, test DB helper

**Estimated scope:** M

### Checkpoint: Database
- [ ] Interactive transactions confirmed working on Neon (rollback really rolls back)
- [ ] Human review before building the rest on top

---

### Phase 3: Fetch and map (tracer bullet through the rules)

## Task 3: `SourceAdapter` interface, registry, and `ingest:fetch` runner

**Description:** Define the source boundary before any real source exists: the `SourceAdapter` interface (see Architecture Decisions), a registry looked up by name, a shared raw-cache module, and the source-agnostic fetch runner behind `ingest:fetch -- <source>`. A fake `fixture` adapter in tests proves the shared code doesn't assume TheMealDB.

**Acceptance criteria:**
- [ ] `src/sources/types.ts` exports `SourceAdapter` and `FetchContext`; registry rejects duplicate names; unknown `<source>` errors with the list of registered sources
- [ ] Raw cache module: `list(source)`, `read(source, id)` (validated with the adapter's `rawSchema`), `write(source, id, raw)`; one file per record
- [ ] Fetch runner validates each yielded record with `rawSchema`, writes new records, skips cached ones, stops at `--limit` (default 100), and reports which id failed validation

**Verification:**
- [ ] Tests with the `fixture` adapter: limit, skip cached, invalid record fails with its id, unknown source error
- [ ] `grep -r themealdb src/ --exclude-dir=sources` finds only the registry line

**Dependencies:** T2

**Files likely touched:** `src/sources/types.ts`, `src/sources/registry.ts`, `src/sources/rawCache.ts`, `src/fetch/runFetch.ts`, `src/cli/fetch.ts`, `test/fixtureSource.ts`, tests

**Estimated scope:** M

## Task 4: TheMealDB adapter

**Description:** The first `SourceAdapter` implementation, entirely inside `src/sources/themealdb/`: raw schema, `rawId`, `fetch` (letter by letter, one request at a time, short delay), and `toSourceRecipe` per SPEC §5.1.

**Acceptance criteria:**
- [ ] `toSourceRecipe`: pairs from `strIngredient1..20`/`strMeasure1..20` skipped when ingredient is `null` or blank; kept strings verbatim (including surrounding whitespace); `servings = null`
- [ ] Tags = lowercased `strCategory` + comma-split `strTags`, plus `vegetarian` for `Vegetarian`/`Vegan`
- [ ] `fetch` yields meals across letters, skips ids where `ctx.isCached(id)`, stops once `ctx.limit` is reached; registered as `themealdb`

**Verification:**
- [ ] Tests with 2–3 real meal fixtures (one vegetarian, one with blank/`null` pairs and padded strings); `fetch` tested with a mocked HTTP client
- [ ] Manual: `npm run ingest:fetch -- themealdb --limit 5` writes 5 files; rerun writes nothing

**Dependencies:** T3

**Files likely touched:** `src/sources/themealdb/{index,raw.schema,fetch,toSourceRecipe}.ts`, `src/sources/registry.ts`, fixtures, tests

**Estimated scope:** M

## Task 5: Catalog schema and matcher

**Description:** A matcher from source name → catalog entry by name or alias (the `CatalogEntry` schema itself landed in T2). No real data yet; tests use a small hand-written catalog. Entries carry a `reviewed` flag so a machine-drafted catalog (T5b) can be used for matching before every entry has been checked by a person.

**Acceptance criteria:**
- [ ] Catalog-level check on read: names and aliases are unique across the whole catalog (an alias can't point at two ingredients, or equal another entry's name)
- [ ] `match(sourceName)` lowercases and trims, matches names and aliases (reviewed or not), returns `null` for unknown names

**Verification:**
- [ ] Tests: name hit, alias hit (`"Red Onion"` → `onion`), whitespace/case, unknown → `null`, duplicate alias rejected at read

**Dependencies:** T2

**Files likely touched:** `src/schema/catalog.ts`, `src/catalog/catalog.ts`, tests

**Estimated scope:** S

## Task 5b: Bootstrap the catalog from TheMealDB's ingredient list

**Description:** Build the first `data/ingredients.json` from TheMealDB's `list.php?i=list` (992 names) instead of CookFlow's 33 seed ingredients. The list is source vocabulary, not canonical ingredients: it has variants (`Bay Leaf` / `Bay Leaves`, `Yellow Onion`, `Melted Butter`, `Free-range egg, beaten`), and `strType` is missing for ~half the names (including `Chicken`, `Beef`, `Basil`) and unreliable for the rest (`Lamb Stock` is a "Sauce"). So Claude proposes, per name, a canonical name, unit, and `isStaple`; grouping by canonical name is then deterministic code, and every entry starts `reviewed: false`.

**Acceptance criteria:**
- [ ] The raw list is cached at `data/themealdb/ingredients.raw.json` (committed); the script lives in `src/sources/themealdb/` but writes the shared catalog format, so nothing downstream knows where an entry came from
- [ ] Claude proposals (batched, validated with zod, cached in `data/catalog/bootstrap-proposals.json` so reruns don't call Claude again) are grouped by canonical name: lowercased source names become `aliases`; a group whose members disagree on unit or staple is written with a `note` for the reviewer
- [ ] Rerunning never changes or removes an entry with `reviewed: true`; SPEC §5.2 and README are updated first to say the catalog comes from TheMealDB's list, not CookFlow's seed

**Verification:**
- [ ] Unit tests with a fake Claude: grouping, alias uniqueness, conflict note, reviewed entries preserved
- [ ] Manual: run it, check the output validates; read 30 random entries and the conflict list

**Dependencies:** T4 (TheMealDB HTTP client), T5. Introduces the shared Claude client (`src/claude/`) that T11 reuses; implement with the `claude-api` skill.

**Files likely touched:** `src/sources/themealdb/bootstrapCatalog.ts`, `src/catalog/group.ts`, `src/claude/client.ts`, `data/ingredients.json`, `SPEC.md`, `README.md`, tests

**Estimated scope:** M

## Task 6: Measure parser and unit conversion

**Description:** Parse measures into a number and unit and convert into the ingredient's unit (SPEC §5.3 step 2–4). Anything ambiguous returns `unmapped`, never a guess.

**Acceptance criteria:**
- [ ] Numbers: integers, decimals, `1/2`, `1 1/2`, unicode fractions (`½`, `1½`)
- [ ] Counted units accept a bare number or matching count word; `g` accepts g/kg/oz/lb; `ml` accepts ml/l/tsp/tbsp/cup; staples with vague text → `1`; results rounded to 2 decimals
- [ ] Count-for-weighed, volume-for-weighed, and vague text return `unmapped` with a reason

**Verification:**
- [ ] Table-driven tests covering every case listed in SPEC §7 plus real measures sampled from TheMealDB fixtures

**Dependencies:** T2

**Files likely touched:** `src/map/measure.ts`, `src/map/measure.test.ts`

**Estimated scope:** S–M

## Task 7: `ingest:map`

**Description:** For any registered source, read the raw cache through the adapter (`rawSchema` + `toSourceRecipe`), then run the shared matcher and parser to produce `data/<source>/recipes.json`. Preserve recipes already `approved` or `dropped`, drop recipes with duplicate canonical ingredients, and write the unmapped-lines report.

**Acceptance criteria:**
- [ ] New and `pending` recipes are (re)generated; `approved`/`dropped` recipes are left byte-identical
- [ ] Two lines → same ingredient sets `status: "dropped"`, `dropReason: duplicate ingredient "<name>"`
- [ ] `data/<source>/reports/unmapped.json` (or `.md`) lists every unmapped line with recipe, name, measure, reason

**Verification:**
- [ ] Tests (using the `fixture` source): merge preserves approved/dropped; duplicate drop; unmapped line has `ingredient/quantity/method = null`
- [ ] Manual: run on the 5 fetched TheMealDB meals, inspect the file and report

**Dependencies:** T3, T5, T6 (T4 only for the manual run)

**Files likely touched:** `src/map/mapRecipe.ts`, `src/map/merge.ts`, `src/cli/map.ts`, tests

**Estimated scope:** M

## Task 8: Validation of approved recipes

**Description:** Validate every `approved` recipe against SPEC §3 rules and §5.6 before load. Load (T9/T10) calls this and refuses to run if anything fails.

**Acceptance criteria:**
- [ ] Every line has a catalog ingredient with `reviewed: true` and a quantity that is > 0, ≤ 999999.99, ≤ 2 decimals
- [ ] No ingredient appears twice; `instructions` is byte-identical to `adapter.toSourceRecipe(rawCache.read(source, sourceId)).instructions` (no source-specific field names in validation)
- [ ] All errors are collected and reported per recipe (not just the first)

**Verification:**
- [ ] Tests for each rejection in SPEC §7 (missing quantity, 3 decimals, unknown ingredient, changed instructions) plus an unreviewed catalog entry
- [ ] Manual: approve one fixture recipe, run `ingest:load -- themealdb --dry-run` end to end

**Dependencies:** T7 (and T9 to wire into load)

**Files likely touched:** `src/validate/validate.ts`, `src/cli/load.ts`, tests

**Estimated scope:** S

### Checkpoint: Rules pipeline end to end
- [ ] fetch → map → (hand-approve 1 recipe) → load --dry-run → load works on a Neon dev branch
- [ ] Look at the unmapped report for 5–20 meals: is the rule coverage good enough that Claude is only handling the tail?
- [ ] Human review

---

### Phase 4: Normalization and reports

## Task 11: `ingest:normalize` with Claude

**Description:** For unmapped lines in `pending` recipes, ask Claude for an existing ingredient + quantity, a proposed new ingredient + quantity, or "can't map". Validate the response with zod and write the proposal into the line with `method: "claude"` and a `note`.

**Acceptance criteria:**
- [ ] Only unmapped lines in `pending` recipes are sent; prompt includes source name, measure, recipe title, and catalog
- [ ] Proposed new ingredients are stored on the line (not in the catalog) in a field the reviewer can see; quantity is validated against the proposed unit
- [ ] Invalid or failed responses leave the line unmapped with a note; the run is resumable (lines already proposed aren't re-sent)

**Verification:**
- [ ] Tests with a fake `propose`: each of the three outcomes, invalid response, approved/dropped recipes untouched
- [ ] Manual: run on the fetched sample, read 10 proposals

**Dependencies:** T7, T5b (reuses its Claude client)

**Files likely touched:** `src/normalize/prompt.ts`, `src/normalize/claude.ts`, `src/normalize/normalize.ts`, `src/schema/reviewed.ts`, `src/cli/normalize.ts`, tests

**Estimated scope:** M

## Task 12: Pipeline report

**Description:** `ingest:report -- <source>` prints counts per stage (raw, pending, approved, dropped, vegetarian approved), dropped recipes with reasons, and unmapped line counts, so progress toward SPEC §6 is visible.

**Acceptance criteria:**
- [ ] Counts per status and per `method`; dropped list with reasons; remaining unmapped lines
- [ ] Catalog review queue: unreviewed entries used by `pending` or `approved` recipes, most-used first
- [ ] Shows progress against the §6 targets (≥ 50 approved, ≥ 10 vegetarian)

**Verification:**
- [ ] Unit test on a fixture `recipes.json`
- [ ] Manual: run after map and after normalize

**Dependencies:** T7

**Files likely touched:** `src/report/report.ts`, `src/cli/report.ts`, `package.json`

**Estimated scope:** S

### Checkpoint: Tooling complete
- [ ] All SPEC §7 tests exist and pass; CI green
- [ ] Human review before the data work

---

### Phase 5: Data (mostly human work)

## Task 13: Fetch and map the full set
- [ ] `ingest:fetch -- themealdb` (~100 meals), `ingest:map`, `ingest:normalize`; commit raw cache and `recipes.json`
- [ ] Extend catalog aliases where the unmapped report shows obvious misses, rerun map

## Task 14: Review
- [ ] Reviewer works through the catalog review queue (T12): fixes unit/staple/aliases and sets `reviewed: true` only on entries that recipes actually use; the other ~900 drafts can stay unreviewed
- [ ] Reviewer accepts/rejects proposed new ingredients (into `data/ingredients.json`), fixes lines (`method: "manual"`), sets each recipe `approved` or `dropped`
- [ ] Report shows ≥ 50 approved, ≥ 10 vegetarian; spot-check 10 random approved recipes against TheMealDB

## Task 15: Load
- [ ] `ingest:load -- themealdb --dry-run`, then real load into the Neon dev branch; second run shows no changes
- [ ] Verify in CookFlow that the planner can use the loaded recipes

### Checkpoint: Complete
- [ ] SPEC §6 targets met; all tests pass; ready for review

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Neon WebSocket `Pool` transactions misbehave (rollback, Node 22 WebSocket) | High | DB tasks in Phase 2, verified against a real dev branch before anything builds on them |
| Rules cover too little; Claude + review becomes the bulk of work | Med | Checkpoint after T7 looks at the unmapped report on real meals; add aliases/count words before T11 |
| Rerunning `map` regenerates `pending` recipes and wipes Claude proposals and partial manual edits on them (SPEC §5.6 only protects approved/dropped) | Med | See Open Question 4; at minimum, warn in the CLI and README |
| Duplicate-ingredient drop rule removes too many recipes | Med | Report counts drops by reason; revisit SPEC §8 Q1 with data |
| CookFlow's dev seed (33 ingredients, `chicken breast`/`rice`/... in `pack`) is already in the target DB, so our `g` entries with the same names conflict at load; its seeder also overwrites units on rerun | High | Load fails safely on conflict. Before Task 15, CookFlow stops seeding ingredients and dev recipes, and the Neon dev branch is reset (Open Question 5) |
| The bootstrapped catalog is large (~990 names) and machine-made | Med | Entries start `reviewed: false`; validation only accepts reviewed entries and load only inserts reviewed + used ones, so review effort scales with the recipes, not the list |
| CookFlow adds a migration and the hand-written schema goes stale | Low (deferred) | Out of scope; re-check CookFlow migrations before Task 15 |

## Open Questions

1. ~~CookFlow seed ingredients~~ **Decided:** don't use CookFlow's 33 seed ingredients; bootstrap the catalog from TheMealDB's ingredient list (T5b).
2. **How does a reviewer accept a proposed new ingredient?** SPEC §5.5 says it joins the catalog "when the reviewer accepts it" but doesn't say how. Proposal: the line carries `proposedIngredient: { name, unit, isStaple }`; the reviewer accepts by adding the entry to `data/ingredients.json` by hand, and validation fails if an approved line points at a name not in the catalog. A helper command can come later.
3. **Skip `Dessert` / `Breakfast`?** (SPEC §8 Q2.) Deciding before T13 changes which ~100 meals we fetch; easiest as a category filter in map that marks them `dropped` with a reason.
4. **Should `map` keep Claude/manual lines in `pending` recipes?** Current spec: no, pending recipes are fully regenerated. Alternative: keep lines whose `method` is `claude` or `manual` and only remap the rest.
5. **Ingredient table ownership** (SPEC §8 Q3). With the catalog now built here, the natural answer is that this repo owns `ingredients`, and CookFlow's `db:seed` stops writing ingredients and its `dev` recipes (or only seeds a local/empty DB). Needs a change in the CookFlow repo before Task 15.
