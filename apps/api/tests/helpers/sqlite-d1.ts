import { Database } from "bun:sqlite";

import type { AppDatabase } from "../../src/platform/db/drizzle";
import { getAppDatabase } from "../../src/platform/db/drizzle";

type RawOptions = { columnNames?: boolean } | undefined;

const statementQueries = new WeakMap<D1PreparedStatement, string>();

export class SqliteD1Database implements D1Database {
  readonly #database = new Database(":memory:");
  readonly #maxBoundParams: number | undefined;

  constructor(input: { foreignKeys?: boolean; maxBoundParams?: number } = {}) {
    this.#maxBoundParams = input.maxBoundParams;
    this.#database.run(`PRAGMA foreign_keys = ${input.foreignKeys === false ? "OFF" : "ON"}`);
  }

  execute(query: string): void {
    this.#database.exec(query);
  }

  prepare(query: string): D1PreparedStatement {
    return createSqliteD1Statement(this.#database, query, [], this.#maxBoundParams);
  }

  app(): AppDatabase {
    return getAppDatabase(this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    this.#database.run("BEGIN");

    try {
      for (const statement of statements) {
        const query = statementQueries.get(statement) ?? "";
        const returnsRows = /^\s*(select|with)\b/i.test(query) || /\breturning\b/i.test(query);
        results.push(
          returnsRows ? await statement.all<T>() : ((await statement.run<T>()) as D1Result<T>),
        );
      }
      this.#database.run("COMMIT");
      return results;
    } catch (error) {
      this.#database.run("ROLLBACK");
      throw error;
    }
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("D1 dump is unavailable in SQLite test fixture.");
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.execute(query);
    return { count: 0, duration: 0 };
  }

  withSession(): D1DatabaseSession {
    return {
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => this.batch<T>(statements),
      getBookmark: () => null,
      prepare: (query: string) => this.prepare(query),
    };
  }
}

function createSqliteD1Statement(
  database: Database,
  query: string,
  values: readonly unknown[] = [],
  maxBoundParams?: number,
): D1PreparedStatement {
  const statement: D1PreparedStatement = {
    all: async <T = unknown>() => {
      const results = database.query(query).all(...values) as T[];
      return { meta: createD1Meta(), results, success: true };
    },
    bind: (...nextValues: unknown[]) => {
      if (maxBoundParams !== undefined && nextValues.length > maxBoundParams) {
        throw new Error(`too many SQL variables: ${nextValues.length} > ${maxBoundParams}`);
      }

      return createSqliteD1Statement(database, query, nextValues, maxBoundParams);
    },
    first: async <T = unknown>(colName?: string) => {
      const row = (database.query(query).get(...values) as Record<string, unknown> | null) ?? null;

      if (row === null) {
        return null;
      }

      if (colName !== undefined) {
        return (row[colName] as T | undefined) ?? null;
      }

      return row as T;
    },
    raw: async <T = unknown[]>(options?: RawOptions) => {
      const sqliteStatement = database.query(query);
      const rows = sqliteStatement.values(...values) as T[];

      if (options?.columnNames === true) {
        return [sqliteStatement.columnNames as T, ...rows];
      }

      return rows;
    },
    run: async <T = unknown>() => {
      const result = database.query(query).run(...values);
      return {
        meta: createD1Meta({ changes: result.changes }),
        results: [] as T[],
        success: true,
      };
    },
  };

  statementQueries.set(statement, query);
  return statement;
}

function createD1Meta(overrides: Partial<D1Meta> = {}): D1Meta {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    size_after: 0,
    ...overrides,
  };
}
