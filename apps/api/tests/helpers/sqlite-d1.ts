import { Database } from "bun:sqlite";

import type { AppDatabase } from "../../src/platform/db/drizzle";
import { getAppDatabase } from "../../src/platform/db/drizzle";

type RawOptions = { columnNames?: boolean } | undefined;

export class SqliteD1Database implements D1Database {
  readonly #database = new Database(":memory:");

  constructor(input: { foreignKeys?: boolean } = {}) {
    this.#database.run(`PRAGMA foreign_keys = ${input.foreignKeys === false ? "OFF" : "ON"}`);
  }

  execute(query: string): void {
    this.#database.exec(query);
  }

  prepare(query: string): D1PreparedStatement {
    return createSqliteD1Statement(this.#database, query);
  }

  app(): AppDatabase {
    return getAppDatabase(this);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    this.#database.run("BEGIN");

    try {
      for (const statement of statements) {
        results.push((await statement.run<T>()) as D1Result<T>);
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
): D1PreparedStatement {
  return {
    all: async <T = unknown>() => {
      const results = database.query(query).all(...values) as T[];
      return { meta: createD1Meta(), results, success: true };
    },
    bind: (...nextValues: unknown[]) => createSqliteD1Statement(database, query, nextValues),
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
      const statement = database.query(query);
      const rows = statement.values(...values) as T[];

      if (options?.columnNames === true) {
        return [statement.columnNames as T, ...rows];
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
