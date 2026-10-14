import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RawCache } from "@/sources/rawCache";
import { fixtureRecord, fixtureSource } from "../../test/fixtureSource";
import { runFetch } from "./runFetch";

const tmp = () => mkdtempSync(join(tmpdir(), "ingest-fetch-"));
const records = (...keys: string[]) => keys.map((k) => fixtureRecord(k));

describe("runFetch", () => {
  it("caches one file per record, exactly as the source returned it", async () => {
    const source = fixtureSource([{ ...fixtureRecord("1") }]);
    const cache = new RawCache(source, tmp());
    await runFetch(source, cache, { limit: 10 });
    const file = readFileSync(join(cache.dir, "1.json"), "utf8");
    expect(file).toBe(`${JSON.stringify(fixtureRecord("1"), null, 2)}\n`);
    expect(cache.read("1").method).toBe("Mix.\r\nServe. ");
  });

  it("stops at the limit without pulling more records from the source", async () => {
    const source = fixtureSource(records("1", "2", "3", "4"));
    const cache = new RawCache(source, tmp());
    const result = await runFetch(source, cache, { limit: 2 });
    expect(result).toEqual({ written: ["1", "2"], skipped: 0, total: 2 });
    expect(source.requested).toEqual(["1", "2"]);
    expect(cache.ids()).toEqual(["1", "2"]);
  });

  it("counts already-cached records toward the limit and never rewrites them", async () => {
    const dir = tmp();
    const first = fixtureSource(records("1", "2"));
    await runFetch(first, new RawCache(first, dir), { limit: 2 });

    const changed = fixtureSource([fixtureRecord("1", { heading: "Changed" }), ...records("2", "3", "4")]);
    const cache = new RawCache(changed, dir);
    expect(await runFetch(changed, cache, { limit: 3 })).toEqual({ written: ["3"], skipped: 2, total: 3 });
    expect(cache.read("1").heading).toBe("Fixture 1");
  });

  it("doesn't call the source at all when the cache is already full", async () => {
    const dir = tmp();
    const first = fixtureSource(records("1"));
    await runFetch(first, new RawCache(first, dir), { limit: 1 });
    const second = fixtureSource(records("2"));
    await runFetch(second, new RawCache(second, dir), { limit: 1 });
    expect(second.requested).toEqual([]);
  });

  it("stops on an invalid record, naming its id, and keeps what was already written", async () => {
    const source = fixtureSource([fixtureRecord("1"), { key: "2", heading: "No method" }, fixtureRecord("3")]);
    const cache = new RawCache(source, tmp());
    await expect(runFetch(source, cache, { limit: 10 })).rejects.toThrow(/fixture record 2 doesn't match its schema[\s\S]*method/);
    expect(cache.ids()).toEqual(["1"]);
  });

  it("refuses an id that isn't safe as a file name", async () => {
    const source = fixtureSource([fixtureRecord("../escape")]);
    await expect(runFetch(source, new RawCache(source, tmp()), { limit: 10 })).rejects.toThrow(/can't be used as a file name/);
  });
});

describe("RawCache", () => {
  it("lists ids in numeric order", async () => {
    const source = fixtureSource(records("10", "9", "100"));
    const cache = new RawCache(source, tmp());
    await runFetch(source, cache, { limit: 10 });
    expect(cache.ids()).toEqual(["9", "10", "100"]);
  });

  it("validates cached files on read", async () => {
    const source = fixtureSource(records("1"));
    const cache = new RawCache(source, tmp());
    await runFetch(source, cache, { limit: 10 });
    writeFileSync(join(cache.dir, "1.json"), JSON.stringify({ key: "1" }));
    expect(() => cache.read("1")).toThrow(/1\.json[\s\S]*heading/);
  });
});
