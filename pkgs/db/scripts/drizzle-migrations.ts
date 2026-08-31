import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";

export interface MigrationDatabase {
  execute(sql: string): void;
}

export interface MigrationJournalEntry {
  readonly idx: number;
  readonly tag: string;
}

interface MigrationJournal {
  readonly entries: readonly MigrationJournalEntry[];
}

const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
const journal = JSON.parse(
  readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
) as MigrationJournal;
const files = readMigrationFiles({ migrationsFolder });
const migrationTagPattern = /^\d{4}_[A-Za-z0-9][A-Za-z0-9_-]*$/u;

export function assertDrizzleMigrationFiles(
  entries: readonly MigrationJournalEntry[],
  sqlFilenames: readonly string[],
  loadedFileCount: number,
): void {
  const expectedFilenames = entries.map(({ tag }) => `${tag}.sql`);
  if (
    entries.length === 0 ||
    loadedFileCount !== entries.length ||
    new Set(expectedFilenames).size !== entries.length ||
    entries.some(
      ({ idx, tag }, position) =>
        idx !== position ||
        !tag.startsWith(`${String(position).padStart(4, "0")}_`) ||
        !migrationTagPattern.test(tag),
    ) ||
    sqlFilenames.length !== expectedFilenames.length ||
    expectedFilenames.some((filename, index) => sqlFilenames[index] !== filename)
  ) {
    throw new Error("The Drizzle migration journal must exactly match its ordered SQL files.");
  }
}

assertDrizzleMigrationFiles(
  journal.entries,
  readdirSync(migrationsFolder)
    .filter((filename) => filename.endsWith(".sql"))
    .toSorted(),
  files.length,
);

export const drizzleMigrations = journal.entries.map((entry, index) => {
  const file = files[index];
  if (file === undefined) throw new Error(`Migration ${entry.tag} has no SQL file.`);
  return {
    bps: file.bps,
    folderMillis: file.folderMillis,
    hash: file.hash,
    index,
    sql: file.sql.filter((statement) => statement.trim() !== ""),
    tag: entry.tag,
  };
});

export const latestDrizzleSnapshotFilename = `${String(drizzleMigrations.length - 1).padStart(
  4,
  "0",
)}_snapshot.json`;

export function getDrizzleMigration(tag: string) {
  const migration = drizzleMigrations.find((candidate) => candidate.tag === tag);
  if (migration === undefined) {
    throw new Error(`Migration ${tag} is missing from the Drizzle journal.`);
  }
  return migration;
}

export function applyDrizzleMigration(database: MigrationDatabase, tag: string): void {
  const migration = getDrizzleMigration(tag);

  database.execute("BEGIN");
  try {
    for (const statement of migration.sql) database.execute(statement.trim());
    database.execute("COMMIT");
  } catch (error) {
    database.execute("ROLLBACK");
    throw error;
  }
}

export function applyDrizzleMigrations(database: MigrationDatabase): void {
  for (const migration of drizzleMigrations) {
    applyDrizzleMigration(database, migration.tag);
  }
}

export async function applyDrizzleMigrationAsync(
  database: MigrationDatabase,
  tag: string,
): Promise<void> {
  applyDrizzleMigration(database, tag);
}

export function applyDrizzleMigrationsBefore(database: MigrationDatabase, tag: string): void {
  const target = getDrizzleMigration(tag);
  for (const migration of drizzleMigrations.slice(0, target.index)) {
    applyDrizzleMigration(database, migration.tag);
  }
}

export function applyDrizzleMigrationsFrom(database: MigrationDatabase, tag: string): void {
  const target = getDrizzleMigration(tag);
  for (const migration of drizzleMigrations.slice(target.index)) {
    applyDrizzleMigration(database, migration.tag);
  }
}

export function applyDrizzleMigrationsThrough(database: MigrationDatabase, tag: string): void {
  const target = getDrizzleMigration(tag);
  for (const migration of drizzleMigrations.slice(0, target.index + 1)) {
    applyDrizzleMigration(database, migration.tag);
  }
}
