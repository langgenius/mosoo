import {
  accountsTable,
  agentDeploymentVersionsTable,
  agentMcpBindingsTable,
  agentsTable,
  agentSkillsTable,
  apiCommandsTable,
  appVibeAppsTable,
  authAccountsTable,
  authSessionsTable,
  authVerificationsTable,
  agentChannelBindingsTable,
  channelConnectionStatesTable,
  channelEventReceiptsTable,
  channelFinalDeliveryJobsTable,
  channelThreadSessionsTable,
  driverCommandsTable,
  driverInstanceMcpGrantsTable,
  driverInstancesTable,
  emailLogsTable,
  environmentRevisionsTable,
  environmentsTable,
  fileVersionsTable,
  fileRecordsTable,
  fileUploadsTable,
  mcpCredentialsTable,
  mcpOauthFlowsTable,
  mcpServersTable,
  nativeResumeRefsTable,
  organizationsTable,
  personalAccessTokensTable,
  appsTable,
  publicApiIdempotencyKeysTable,
  publicApiRateLimitWindowsTable,
  sandboxBackupsTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionExecutionSnapshotsTable,
  sessionEventsTable,
  sessionMessagesTable,
  sessionModelCallsTable,
  sessionPermissionRequestsTable,
  sessionReadinessSnapshotsTable,
  sessionRunsTable,
  sessionRunSkillsTable,
  sessionsTable,
  skillsTable,
  skillSnapshotEntriesTable,
  skillSnapshotsTable,
  usageDailyRollupsTable,
  usageEventsTable,
  vaultSecretsTable,
  vendorCredentialsTable,
  wechatChannelAccountsTable,
  wechatChannelPairingsTable,
  wechatContextTokensTable,
} from "@mosoo/db";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

const schema = {
  accountsTable,
  agentDeploymentVersionsTable,
  agentMcpBindingsTable,
  agentsTable,
  agentSkillsTable,
  apiCommandsTable,
  appVibeAppsTable,
  authAccountsTable,
  authSessionsTable,
  authVerificationsTable,
  agentChannelBindingsTable,
  channelConnectionStatesTable,
  channelEventReceiptsTable,
  channelFinalDeliveryJobsTable,
  channelThreadSessionsTable,
  driverCommandsTable,
  driverInstanceMcpGrantsTable,
  driverInstancesTable,
  emailLogsTable,
  environmentRevisionsTable,
  environmentsTable,
  fileVersionsTable,
  fileRecordsTable,
  fileUploadsTable,
  mcpCredentialsTable,
  mcpOauthFlowsTable,
  mcpServersTable,
  nativeResumeRefsTable,
  organizationsTable,
  personalAccessTokensTable,
  appsTable,
  publicApiIdempotencyKeysTable,
  publicApiRateLimitWindowsTable,
  sandboxBackupsTable,
  sandboxesTable,
  sandboxSessionsTable,
  sessionExecutionSnapshotsTable,
  sessionEventsTable,
  sessionMessagesTable,
  sessionModelCallsTable,
  sessionPermissionRequestsTable,
  sessionReadinessSnapshotsTable,
  sessionRunsTable,
  sessionRunSkillsTable,
  sessionsTable,
  skillsTable,
  skillSnapshotEntriesTable,
  skillSnapshotsTable,
  usageDailyRollupsTable,
  usageEventsTable,
  vaultSecretsTable,
  vendorCredentialsTable,
  wechatChannelAccountsTable,
  wechatChannelPairingsTable,
  wechatContextTokensTable,
};

type CompatD1RawOptions = { columnNames?: boolean } | undefined;

const originalD1Statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
const d1StatementQueries = new WeakMap<D1PreparedStatement, string>();

function unwrapD1Statement(statement: D1PreparedStatement): D1PreparedStatement {
  return originalD1Statements.get(statement) ?? statement;
}

function readD1StatementQuery(statement: D1PreparedStatement): string | null {
  return d1StatementQueries.get(statement) ?? null;
}

async function readRawRows<T = unknown[]>(
  statement: D1PreparedStatement,
  options?: CompatD1RawOptions,
): Promise<T[]> {
  if (typeof statement.raw !== "function") {
    throw new TypeError("D1 statement does not support raw().");
  }

  const readRaw = statement.raw as (options?: CompatD1RawOptions) => Promise<unknown[]>;
  return (await readRaw.call(statement, options)) as T[];
}

async function readAllRows<T = unknown>(statement: D1PreparedStatement): Promise<D1Result<T>> {
  if (typeof statement.all === "function") {
    try {
      const result = await statement.all<T>();

      if (result.results.length > 0 || typeof statement.first !== "function") {
        return result;
      }

      const row = await statement.first<T>();
      return row === null
        ? result
        : ({
            ...result,
            results: [row],
          } as D1Result<T>);
    } catch (error) {
      if (!isCompatMethodNotImplementedError(error) || typeof statement.first !== "function") {
        throw error;
      }
    }
  }

  if (typeof statement.first === "function") {
    const row = await statement.first<T>();
    return {
      meta: {},
      results: row === null ? [] : [row],
      success: true,
    } as D1Result<T>;
  }

  throw new TypeError("D1 statement does not support all() or first().");
}

function isRowReturningBatchQuery(query: string): boolean {
  return /^\s*(select|with)\b/i.test(query) || /\breturning\b/i.test(query);
}

function assertBatchStatementsDoNotReturnRows(statements: readonly D1PreparedStatement[]): void {
  for (const statement of statements) {
    const query = readD1StatementQuery(statement);

    if (query !== null && isRowReturningBatchQuery(query)) {
      throw new TypeError("D1 batch does not support row-returning statements.");
    }
  }
}

function wrapD1Statement(statement: D1PreparedStatement, query: string): D1PreparedStatement {
  const raw = async <T = unknown[]>(options?: CompatD1RawOptions): Promise<T[]> =>
    readRawRows<T>(statement, options);

  const wrapped: D1PreparedStatement = {
    all: async <T = unknown>() => readAllRows<T>(statement),
    bind: (...values: unknown[]) => wrapD1Statement(statement.bind(...values), query),
    first: async <T = unknown>(colName?: string) => {
      if (typeof statement.first === "function") {
        return colName === undefined ? statement.first<T>() : statement.first<T>(colName);
      }

      const { results } = await readAllRows<Record<string, unknown>>(statement);
      const row = results[0];

      if (!row) {
        return null;
      }

      if (colName !== undefined) {
        return (row[colName] as T | undefined) ?? null;
      }

      return row as T;
    },
    raw: raw as D1PreparedStatement["raw"],
    run: async () => {
      if (typeof statement.run !== "function") {
        throw new TypeError("D1 statement does not support run().");
      }

      return statement.run();
    },
  };

  originalD1Statements.set(wrapped, statement);
  d1StatementQueries.set(wrapped, query);
  return wrapped;
}

function isCompatMethodNotImplementedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("not used by this");
}

function createCompatD1Database(database: D1Database): D1Database {
  return {
    batch: async (statements) => {
      assertBatchStatementsDoNotReturnRows(statements);

      if (typeof database.batch === "function") {
        return database.batch(statements.map((statement) => unwrapD1Statement(statement)));
      }

      const results: D1Result[] = [];

      for (const statement of statements) {
        results.push(await statement.run());
      }

      return results;
    },
    prepare: (query) => wrapD1Statement(database.prepare(query), query),
  } as D1Database;
}

function createAppDatabase(database: D1Database) {
  return drizzle(createCompatD1Database(database), { schema });
}

export type AppDatabase = ReturnType<typeof createAppDatabase>;

const databaseCache = new WeakMap<D1Database, AppDatabase>();

export function getAppDatabase(database: D1Database): AppDatabase {
  const cached = databaseCache.get(database);

  if (cached) {
    return cached;
  }

  const appDatabase = createAppDatabase(database);
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

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function getD1ChangeCount(result: unknown): number {
  if (!isRecord(result)) {
    return 0;
  }

  const meta = isRecord(result["meta"]) ? result["meta"] : null;
  return readNumber(meta?.["changes"]) ?? readNumber(result["changes"]) ?? 0;
}

function toParameterizedSql(query: string, params: readonly unknown[]): SQL {
  const parts = query.split("?");

  if (parts.length !== params.length + 1) {
    throw new Error("SQL placeholder count does not match bound values.");
  }

  const chunks: SQL[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (part) {
      chunks.push(sql.raw(part));
    }

    if (index < params.length) {
      chunks.push(sql`${params[index]}`);
    }
  }

  return sql.join(chunks, sql.raw(""));
}

export function parameterizedSql(query: string, params: readonly unknown[]): SQL {
  return toParameterizedSql(query, params);
}
