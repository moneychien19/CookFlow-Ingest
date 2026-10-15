import { isNull, sql } from "drizzle-orm";
import { boolean, check, integer, numeric, pgTable, primaryKey, serial, text, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { UNITS, type Unit } from "@/schema/catalog";

/*
 * The three CookFlow tables this repo writes, copied by hand from CookFlow's
 * src/lib/db/schema.ts as of migration 0002_user_ingredients. CookFlow owns the tables
 * and migrations; nothing here creates or changes them (SPEC §3). Keeping this in
 * sync is out of scope for now.
 */

/** `'a', 'b', ...` for an IN (...) check. Values are our own constants, never user input. */
const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const ingredients = pgTable(
  "ingredients",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    unit: text("unit").$type<Unit>().notNull(),
    isStaple: boolean("is_staple").notNull().default(false),
    /**
     * Null for the shared catalog, the only rows this repo writes or reads; a user id for an
     * ingredient a cook added in CookFlow. The foreign key to `users` isn't copied.
     */
    ownerId: text("owner_id"),
  },
  (t) => [
    check("ingredients_unit_check", sql`${t.unit} in (${sqlList(UNITS)})`),
    uniqueIndex("ingredients_catalog_name_unique").on(t.name).where(sql`${t.ownerId} is null`),
    uniqueIndex("ingredients_owner_name_unique").on(t.ownerId, t.name).where(sql`${t.ownerId} is not null`),
  ],
);

/** Catalog rows only: never a cook's own ingredient, even one with the same name. */
export const isCatalog = isNull(ingredients.ownerId);

export const recipes = pgTable(
  "recipes",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    imageUrl: text("image_url"),
    instructions: text("instructions").notNull(),
    servings: integer("servings"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [unique("recipes_source_unique").on(t.source, t.sourceId)],
);

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    recipeId: integer("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: integer("ingredient_id")
      .notNull()
      .references(() => ingredients.id),
    quantity: numeric("quantity", { precision: 8, scale: 2, mode: "number" }).notNull(),
    sourceName: text("source_name").notNull(),
    sourceMeasure: text("source_measure").notNull(),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.ingredientId] })],
);
