import { describe, expect, test } from "bun:test";

import {
  extractTableNames,
  findMissingProdTables,
  parseExpectedTableNames,
} from "../bin/prod-schema-guard";

describe("parseExpectedTableNames", () => {
  test("extracts backtick-quoted table names, dedups, and handles IF NOT EXISTS", () => {
    const sql = [
      "CREATE TABLE `agent` (",
      "  `id` text PRIMARY KEY NOT NULL",
      ");",
      "CREATE TABLE IF NOT EXISTS `session_run` (",
      "  `id` text PRIMARY KEY NOT NULL",
      ");",
      "CREATE INDEX `agent_app_idx` ON `agent` (`app_id`);",
    ].join("\n");

    expect(parseExpectedTableNames(sql).toSorted()).toEqual(["agent", "session_run"]);
  });

  test("returns an empty list when there are no CREATE TABLE statements", () => {
    expect(parseExpectedTableNames("CREATE INDEX `x` ON `y` (`z`);")).toEqual([]);
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
