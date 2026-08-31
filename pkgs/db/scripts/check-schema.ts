#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { generateSQLiteDrizzleJson } from "drizzle-kit/api";

import {
  assertProdSchemaMatches,
  createProdSchemaCatalogFromDrizzleSnapshot,
  DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG,
} from "../src/deploy-schema-guard";
import * as schema from "../src/index";
import { latestDrizzleSnapshotFilename } from "./drizzle-migrations";

function comparableSnapshot(value: Record<string, unknown>): unknown {
  const { _meta, id, prevId, ...snapshot } = value;
  void _meta;
  void id;
  void prevId;
  return snapshot;
}

const metaDirectory = new URL("../drizzle/meta/", import.meta.url);
const snapshotFilename = latestDrizzleSnapshotFilename;
const checkedIn = JSON.parse(
  await readFile(new URL(snapshotFilename, metaDirectory), "utf8"),
) as Record<string, unknown>;
const generated = JSON.parse(JSON.stringify(await generateSQLiteDrizzleJson(schema))) as Record<
  string,
  unknown
>;

if (!isDeepStrictEqual(comparableSnapshot(checkedIn), comparableSnapshot(generated))) {
  throw new Error(
    `Drizzle source schema differs from ${snapshotFilename}; generate and review an append-only migration.`,
  );
}

assertProdSchemaMatches(
  createProdSchemaCatalogFromDrizzleSnapshot(checkedIn),
  DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG,
);

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stdout.write(`Drizzle source schema matches ${snapshotFilename}.\n`);
} else if (args.length === 1 && args[0] === "--catalog") {
  process.stdout.write(`${JSON.stringify(checkedIn)}\n`);
} else {
  throw new Error("Usage: bun pkgs/db/scripts/check-schema.ts [--catalog]");
}
