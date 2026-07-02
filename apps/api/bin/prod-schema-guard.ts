/**
 * Fail-fast guard against the DEPLOY-D1-001 hazard.
 *
 * `wrangler d1 migrations apply` records applied migrations by FILENAME, so a
 * rewritten `0000_baseline.sql` (this repo's alpha workflow) is treated as
 * already-applied on a database that recorded the previous baseline. A new
 * `CREATE TABLE` in the rewritten baseline then never reaches prod, yet the
 * Worker deploys referencing it. We keep the fast rewrite-the-baseline flow but
 * refuse to ship a Worker whose expected tables are missing from live prod.
 *
 * These functions are pure (no I/O) so the deploy script can stay thin and the
 * detection logic stays unit-testable. Table-level only: this catches a missing
 * table — the catastrophic case where every query against it fails — not an
 * added column on an existing table.
 */

const CREATE_TABLE_PATTERN = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`([^`]+)`/gi;

/** Table names declared by the migration baseline wrangler treats as applied. */
export function parseExpectedTableNames(migrationSql: string): string[] {
  const names = new Set<string>();

  for (const match of migrationSql.matchAll(CREATE_TABLE_PATTERN)) {
    const name = match[1];

    if (name !== undefined) {
      names.add(name);
    }
  }

  return [...names];
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
