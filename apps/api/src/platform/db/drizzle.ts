import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export type AppDatabase = DrizzleD1Database;

const databaseCache = new WeakMap<D1Database, AppDatabase>();

export function getAppDatabase(database: D1Database): AppDatabase {
  const cached = databaseCache.get(database);

  if (cached) {
    return cached;
  }

  const appDatabase = drizzle(database);
  databaseCache.set(database, appDatabase);
  return appDatabase;
}

type AppDatabaseBatchQueries = Parameters<AppDatabase["batch"]>[0];
type AppDatabaseBatchResult = Awaited<ReturnType<AppDatabase["batch"]>>;

export async function runAppDatabaseBatch(
  database: D1Database,
  buildQueries: (database: AppDatabase) => AppDatabaseBatchQueries,
): Promise<AppDatabaseBatchResult> {
  const db = getAppDatabase(database);
  return db.batch(buildQueries(db));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getD1ChangeCount(result: unknown): number {
  if (!isRecord(result) || !isRecord(result["meta"])) {
    return 0;
  }

  const changes = result["meta"]["changes"];
  return typeof changes === "number" ? changes : 0;
}
