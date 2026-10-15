import type { Pool } from "@neondatabase/serverless";

/**
 * A database's schema as sorted lines, one per object, so two databases can be compared
 * line by line: tables, columns (type, null, default), constraints, indexes, enums, and
 * triggers in `public`, plus the drizzle migrations CookFlow has applied. Row data and
 * object ids aren't included.
 */
export async function readSchema(pool: Pool): Promise<string[]> {
  const rows = async (query: string) => (await pool.query<{ line: string }>(query)).rows.map((r) => r.line);
  const lines = [
    ...(await rows(`
      select 'table ' || relname as line from pg_class
      where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'm')`)),
    ...(await rows(`
      select 'column ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
        || case when a.attnotnull then ' not null' else '' end
        || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
        || case when a.attidentity <> '' then ' identity ' || a.attidentity::text else '' end
        || case when a.attgenerated <> '' then ' generated' else '' end as line
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped`)),
    ...(await rows(`
      select 'constraint ' || conrelid::regclass || '.' || conname || ' ' || pg_get_constraintdef(oid) as line
      from pg_constraint where connamespace = 'public'::regnamespace`)),
    ...(await rows(`select 'index ' || tablename || '.' || indexname || ' ' || indexdef as line from pg_indexes where schemaname = 'public'`)),
    ...(await rows(`
      select 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' order by e.enumsortorder) as line
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      where t.typnamespace = 'public'::regnamespace group by t.typname`)),
    ...(await rows(`
      select 'trigger ' || tgrelid::regclass || '.' || tgname || ' ' || pg_get_triggerdef(oid) as line
      from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)`)),
    ...(await rows(`select 'migration ' || hash as line from drizzle.__drizzle_migrations`).catch(() => [
      "migration (no drizzle.__drizzle_migrations table)",
    ])),
  ];
  return lines.sort();
}

/** What differs between two `readSchema` results, as "only in <name>: <line>". Empty when they match. */
export function diffSchemas(a: { name: string; lines: string[] }, b: { name: string; lines: string[] }): string[] {
  const inA = new Set(a.lines);
  const inB = new Set(b.lines);
  return [
    ...a.lines.filter((l) => !inB.has(l)).map((l) => `only in ${a.name}: ${l}`),
    ...b.lines.filter((l) => !inA.has(l)).map((l) => `only in ${b.name}: ${l}`),
  ];
}
