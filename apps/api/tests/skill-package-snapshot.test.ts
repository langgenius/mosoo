import { describe, expect, test } from "bun:test";

import { skillSnapshotEntriesTable } from "@mosoo/db";
import type { AppId } from "@mosoo/id";
import { createZipArchive } from "@mosoo/skill-package";

import { publishSkillSnapshot } from "../src/modules/skills/application/skill-package-snapshot.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpTestBindings,
  PublicApiMemoryFileBucket,
} from "./helpers/public-api-http-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const APP_ID = "01J00000000000000000000002" as AppId;
const textEncoder = new TextEncoder();

class BindLimitedD1Database implements D1Database {
  constructor(
    private readonly inner: D1Database,
    private readonly maxBindings: number,
  ) {}

  prepare(query: string): D1PreparedStatement {
    const statement = this.inner.prepare(query);

    return {
      ...statement,
      bind: (...values: unknown[]) => {
        if (values.length > this.maxBindings) {
          throw new Error(`Test D1 bind limit exceeded: ${values.length} > ${this.maxBindings}`);
        }

        return statement.bind(...values);
      },
    };
  }

  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    return this.inner.batch<T>(statements);
  }

  dump(): Promise<ArrayBuffer> {
    return this.inner.dump();
  }

  exec(query: string): Promise<D1ExecResult> {
    return this.inner.exec(query);
  }

  withSession(): D1DatabaseSession {
    return this.inner.withSession();
  }
}

function encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function createSkillSnapshotDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE skill_snapshot (
      id text PRIMARY KEY NOT NULL,
      author text NOT NULL,
      blob_key text NOT NULL,
      blob_sha256 text NOT NULL,
      blob_size integer NOT NULL,
      created_at integer NOT NULL,
      description text NOT NULL,
      name text NOT NULL,
      app_id text NOT NULL,
      skill_markdown_path text NOT NULL,
      uncompressed_size integer NOT NULL,
      version text
    );

    CREATE UNIQUE INDEX skill_snapshot_blob_sha256_idx
      ON skill_snapshot (app_id, blob_sha256);

    CREATE TABLE skill_snapshot_entry (
      entry_kind text NOT NULL,
      is_executable integer NOT NULL,
      mime_type text,
      path text NOT NULL,
      sha256 text,
      size integer NOT NULL,
      snapshot_id text NOT NULL,
      PRIMARY KEY (snapshot_id, path)
    );
  `);

  return database;
}

function createLargeWrappedSkillArchive(): Uint8Array {
  return createZipArchive([
    {
      body: encode("---\nname: xlsx\ndescription: spreadsheet skill\n---\n# XLSX\n"),
      entryKind: "file",
      isExecutable: false,
      path: "xlsx/SKILL.md",
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      body: encode(`support file ${index}`),
      entryKind: "file" as const,
      isExecutable: false,
      path: `xlsx/references/file-${index}.txt`,
    })),
  ]);
}

describe("publishSkillSnapshot", () => {
  test("stores large skill snapshot entries without exceeding a single D1 bind limit", async () => {
    const sqlite = createSkillSnapshotDatabase();
    const limitedDatabase = new BindLimitedD1Database(sqlite, 100);
    const bucket = new PublicApiMemoryFileBucket();
    const bindings = createPublicHttpTestBindings(limitedDatabase, {
      fileBucket: bucket as unknown as R2Bucket,
    }) as ApiBindings;

    const published = await publishSkillSnapshot(
      bindings,
      { appId: APP_ID },
      {
        file: {
          bytes: createLargeWrappedSkillArchive(),
          name: "xlsx.zip",
        },
      },
    );

    const rows = await sqlite
      .app()
      .select({ path: skillSnapshotEntriesTable.path })
      .from(skillSnapshotEntriesTable)
      .all();

    expect(published.snapshot.name).toBe("xlsx");
    expect(published.entries).toHaveLength(22);
    expect(rows).toHaveLength(22);
    expect(rows.map((row) => row.path)).toContain("SKILL.md");
    expect(rows.map((row) => row.path)).toContain("references/file-19.txt");
  });
});
