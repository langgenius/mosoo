import { describe, expect, test } from "bun:test";

import {
  extractTableNames,
  findMissingProdTables,
  getLatestSnapshotFilename,
  parseExpectedTableNames,
} from "../bin/prod-schema-guard";

describe("getLatestSnapshotFilename", () => {
  test("resolves the latest Drizzle snapshot from the journal", () => {
    expect(
      getLatestSnapshotFilename(
        JSON.stringify({
          entries: [
            { idx: 0, tag: "0000_baseline" },
            { idx: 1 },
            { idx: 2 },
            { idx: 3 },
            { idx: 4 },
          ],
        }),
      ),
    ).toBe("0004_snapshot.json");
  });

  test("fails closed when the journal has no valid latest entry", () => {
    expect(() => getLatestSnapshotFilename('{"entries":[]}')).toThrow();
  });

  test("fails closed when journal indexes are out of order, duplicated, or non-contiguous", () => {
    for (const entries of [
      [{ idx: 1 }, { idx: 0 }],
      [{ idx: 0 }, { idx: 0 }],
      [{ idx: 0 }, { idx: 2 }],
    ]) {
      expect(() => getLatestSnapshotFilename(JSON.stringify({ entries }))).toThrow();
    }
  });
});

describe("parseExpectedTableNames", () => {
  test("extracts sorted table names from a Drizzle snapshot", () => {
    const snapshot = JSON.stringify({
      tables: {
        session_run: { name: "session_run" },
        agent: { name: "agent" },
      },
    });

    expect(parseExpectedTableNames(snapshot)).toEqual(["agent", "session_run"]);
  });

  test("fails closed when the snapshot has no tables object", () => {
    expect(() => parseExpectedTableNames("{}")).toThrow();
  });

  test("fails closed when the snapshot tables object is empty", () => {
    expect(() => parseExpectedTableNames('{"tables":{}}')).toThrow();
  });

  test("resolves the checked-in migration chain to a non-empty latest snapshot", async () => {
    const metaDir = new URL("../../../pkgs/db/drizzle/meta/", import.meta.url);
    const journal = await Bun.file(new URL("_journal.json", metaDir)).text();
    const snapshotFilename = getLatestSnapshotFilename(journal);
    const snapshot = await Bun.file(new URL(snapshotFilename, metaDir)).text();
    const tableNames = parseExpectedTableNames(snapshot);

    expect(tableNames).toContain("api_command");
    expect(tableNames).toContain("usage_event_rollup_receipt");
  });
});

describe("findMissingProdTables", () => {
  test("returns expected tables absent from the live database", () => {
    expect(findMissingProdTables(["agent", "session_run", "app"], ["agent", "app"])).toEqual([
      "session_run",
    ]);
  });

  test("returns empty when every expected table is present (extra live tables are ignored)", () => {
    expect(findMissingProdTables(["agent"], ["agent", "d1_migrations", "_cf_KV"])).toEqual([]);
  });
});

describe("extractTableNames", () => {
  test("parses the wrangler d1 execute --json result shape", () => {
    const stdout = JSON.stringify([
      { results: [{ name: "agent" }, { name: "session_run" }], success: true, meta: {} },
    ]);

    expect(extractTableNames(stdout)).toEqual(["agent", "session_run"]);
  });

  test("tolerates leading log lines before the JSON array", () => {
    const stdout = `🌀 Executing on remote database DB\n${JSON.stringify([
      { results: [{ name: "agent" }] },
    ])}`;

    expect(extractTableNames(stdout)).toEqual(["agent"]);
  });

  test("throws (fails closed) when no JSON array is present", () => {
    expect(() => extractTableNames("error: could not connect")).toThrow();
  });
});
