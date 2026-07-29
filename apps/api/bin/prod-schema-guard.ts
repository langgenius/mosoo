/**
 * Fail-fast guard against the DEPLOY-D1-001 hazard.
 *
 * `wrangler d1 migrations apply` records applied migrations by filename. This
 * guard detects damage from skipped, rewritten, or incomplete migrations by
 * comparing the live database with the latest Drizzle schema snapshot. Applied
 * migrations are immutable; every production schema change must use a new file.
 *
 * These functions are pure (no I/O) so the deploy script can stay thin and the
 * detection logic stays unit-testable. Table-level only: this catches a missing
 * table — the catastrophic case where every query against it fails — not an
 * added column on an existing table.
 */

interface DrizzleJournal {
  entries?: unknown;
}

interface DrizzleSnapshot {
  tables?: unknown;
}

/** Latest snapshot filename recorded by Drizzle's migration journal. */
export function getLatestSnapshotFilename(rawJournal: string): string {
  const journal = JSON.parse(rawJournal) as DrizzleJournal | null;
  const entries: readonly unknown[] = Array.isArray(journal?.entries) ? journal.entries : [];

  if (entries.length === 0) {
    throw new Error("Drizzle migration journal has no valid latest entry.");
  }

  for (const [expectedIndex, entry] of entries.entries()) {
    const index =
      typeof entry === "object" && entry !== null && "idx" in entry ? entry.idx : undefined;

    if (index !== expectedIndex) {
      throw new Error("Drizzle migration journal indexes must be contiguous from zero.");
    }
  }

  return `${String(entries.length - 1).padStart(4, "0")}_snapshot.json`;
}

/** Table names declared by the latest Drizzle schema snapshot. */
export function parseExpectedTableNames(rawSnapshot: string): string[] {
  const snapshot = JSON.parse(rawSnapshot) as DrizzleSnapshot | null;

  if (
    snapshot === null ||
    typeof snapshot.tables !== "object" ||
    snapshot.tables === null ||
    Array.isArray(snapshot.tables)
  ) {
    throw new Error("Drizzle schema snapshot has no valid tables object.");
  }

  const tableNames = Object.keys(snapshot.tables).toSorted();

  if (tableNames.length === 0) {
    throw new Error("Drizzle schema snapshot has no tables.");
  }

  return tableNames;
}

/** Expected tables that are not present in the live database. */
export function findMissingProdTables(
  expectedTableNames: readonly string[],
  liveTableNames: readonly string[],
): string[] {
  const live = new Set(liveTableNames);
  return expectedTableNames.filter((name) => !live.has(name));
}

interface D1ExecuteResult {
  results?: ReadonlyArray<{ name?: unknown }>;
}

/**
 * Extract `name` rows from `wrangler d1 execute --json` output. The `--json`
 * flag prints the result array on stdout; we slice from the first `[` to the
 * last `]` to tolerate any leading log lines, then fail loudly on an
 * unrecognized shape rather than silently reporting zero tables.
 */
export function extractTableNames(rawStdout: string): string[] {
  const start = rawStdout.indexOf("[");
  const end = rawStdout.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Could not locate JSON array in \`d1 execute\` output:\n${rawStdout}`);
  }

  const parsed = JSON.parse(rawStdout.slice(start, end + 1)) as D1ExecuteResult[];
  const rows = parsed[0]?.results ?? [];

  return rows.map((row) => row.name).filter((name): name is string => typeof name === "string");
}
