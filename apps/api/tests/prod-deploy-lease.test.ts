import { describe, expect, test } from "bun:test";

import { acquireProdDeployLease } from "../bin/deploy-prod";
import {
  acquireProdDeployLeaseStatements,
  assertProdDeployLeaseOwned,
  assertProdDeployLeaseReleased,
  PROD_DEPLOY_LEASE_TABLE,
  PROD_DEPLOY_LEASE_TABLE_SQL,
  releaseProdDeployLeaseStatements,
  verifyProdDeployLeaseStatements,
} from "../bin/prod-deploy-lease";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNED_ROW = {
  owner: OWNER_A,
  table_sql: PROD_DEPLOY_LEASE_TABLE_SQL,
  trigger_count: 0,
};

async function executeBatch(database: SqliteD1Database, statements: readonly string[]) {
  return JSON.stringify(await database.batch(statements.map((sql) => database.prepare(sql))));
}

async function readOwner(database: SqliteD1Database): Promise<string | null> {
  const row = await database
    .prepare(`SELECT "owner" FROM "${PROD_DEPLOY_LEASE_TABLE}" WHERE "id" = 1`)
    .first<{ owner: string }>();
  return row?.owner ?? null;
}

describe("production deploy lease", () => {
  test("keeps a duplicate same-owner batch idempotent while the mutex remains held", async () => {
    const database = new SqliteD1Database();
    await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_A));

    const retried = await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_A));
    expect(() =>
      assertProdDeployLeaseOwned(`[wrangler warning]\n${retried}\n[trailing warning]`, OWNER_A),
    ).not.toThrow();
    expect(await readOwner(database)).toBe(OWNER_A);
  });

  test("verifies ownership without mutating the durable mutex", async () => {
    const database = new SqliteD1Database();
    assertProdDeployLeaseOwned(
      await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_A)),
      OWNER_A,
    );

    assertProdDeployLeaseOwned(
      await executeBatch(database, verifyProdDeployLeaseStatements()),
      OWNER_A,
    );
    expect(await readOwner(database)).toBe(OWNER_A);
  });

  test.each([
    ["no statement", JSON.stringify([])],
    [
      "wrong statement count",
      JSON.stringify([
        { results: [], success: true },
        { results: [OWNED_ROW], success: true },
      ]),
    ],
    ["no row", JSON.stringify([{ results: [], success: true }])],
    ["multiple rows", JSON.stringify([{ results: [OWNED_ROW, OWNED_ROW], success: true }])],
    [
      "malformed owner",
      JSON.stringify([{ results: [{ ...OWNED_ROW, owner: null }], success: true }]),
    ],
  ])("rejects an owned-mutex readback with %s", (_label, raw) => {
    expect(() => assertProdDeployLeaseOwned(raw, OWNER_A)).toThrow();
  });

  test("retries release after the owner delete response is lost", async () => {
    const database = new SqliteD1Database();
    assertProdDeployLeaseOwned(
      await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_A)),
      OWNER_A,
    );
    await executeBatch(database, releaseProdDeployLeaseStatements(OWNER_A));

    const retried = await executeBatch(database, releaseProdDeployLeaseStatements(OWNER_A));
    expect(() => assertProdDeployLeaseReleased(retried)).not.toThrow();
    expect(await readOwner(database)).toBeNull();
  });

  test("never transfers ownership until the current owner explicitly releases", async () => {
    const database = new SqliteD1Database();
    assertProdDeployLeaseOwned(
      await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_A)),
      OWNER_A,
    );

    const contended = await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_B));
    expect(() => assertProdDeployLeaseOwned(contended, OWNER_B)).toThrow("another owner");
    expect(await readOwner(database)).toBe(OWNER_A);

    assertProdDeployLeaseOwned(
      await executeBatch(database, verifyProdDeployLeaseStatements()),
      OWNER_A,
    );
    assertProdDeployLeaseReleased(
      await executeBatch(database, releaseProdDeployLeaseStatements(OWNER_A)),
    );

    assertProdDeployLeaseOwned(
      await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_B)),
      OWNER_B,
    );
    const staleVerification = await executeBatch(database, verifyProdDeployLeaseStatements());
    expect(() => assertProdDeployLeaseOwned(staleVerification, OWNER_A)).toThrow("another owner");

    const lateRelease = await executeBatch(database, releaseProdDeployLeaseStatements(OWNER_A));
    expect(() => assertProdDeployLeaseReleased(lateRelease)).toThrow();
    expect(await readOwner(database)).toBe(OWNER_B);

    const release = await executeBatch(database, releaseProdDeployLeaseStatements(OWNER_B));
    expect(() => assertProdDeployLeaseReleased(release)).not.toThrow();
    expect(await readOwner(database)).toBeNull();
  });

  test("sends one acquisition request and retains a late commit for exact-owner recovery", async () => {
    const database = new SqliteD1Database();
    const lostResponse = new Error("acquisition response was lost");
    let calls = 0;
    let commitLate: (() => Promise<string>) | undefined;

    expect(() =>
      acquireProdDeployLease(OWNER_A, (statements) => {
        calls += 1;
        commitLate = () => executeBatch(database, statements);
        throw lostResponse;
      }),
    ).toThrow(lostResponse);
    expect(calls).toBe(1);

    await commitLate?.();
    expect(await readOwner(database)).toBe(OWNER_A);
    assertProdDeployLeaseReleased(
      await executeBatch(database, releaseProdDeployLeaseStatements(OWNER_A)),
    );
  });

  test("retains the mutex after deployment failure and releases it only after success", async () => {
    const source = await Bun.file(new URL("../bin/deploy-prod.ts", import.meta.url)).text();
    const retained = source.indexOf("✗ Retaining production deploy lease");
    const rethrown = source.indexOf("throw error;", retained);
    const released = source.indexOf("releaseProdDeployLease();", rethrown);

    expect(retained).toBeGreaterThanOrEqual(0);
    expect(rethrown).toBeGreaterThan(retained);
    expect(released).toBeGreaterThan(rethrown);
  });

  test("rejects incomplete or non-empty release readbacks", () => {
    const incomplete = JSON.stringify([{ results: [], success: true }]);
    const multipleOwners = JSON.stringify([
      { results: [], success: true },
      { results: [{ owner: OWNER_B }, { owner: OWNER_B }], success: true },
    ]);

    expect(() => assertProdDeployLeaseReleased(incomplete)).toThrow();
    expect(() => assertProdDeployLeaseReleased(multipleOwners)).toThrow();
  });

  test("fails closed when the reserved lease table has a spoofed schema", async () => {
    const database = new SqliteD1Database();
    database.execute(`
      CREATE TABLE "${PROD_DEPLOY_LEASE_TABLE}" (
        "id" integer PRIMARY KEY,
        "owner" text NOT NULL,
        "expires_at" integer NOT NULL
      )
    `);

    const acquired = await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_A));
    expect(() => assertProdDeployLeaseOwned(acquired, OWNER_A)).toThrow("schema is invalid");
  });

  test("rejects lease-table triggers before they can change or release ownership", async () => {
    const database = new SqliteD1Database();
    assertProdDeployLeaseOwned(
      await executeBatch(database, acquireProdDeployLeaseStatements(OWNER_A)),
      OWNER_A,
    );
    database.execute(`
      CREATE TRIGGER mutate_deploy_lease
      AFTER DELETE ON "${PROD_DEPLOY_LEASE_TABLE}"
      BEGIN
        SELECT 1;
      END
    `);

    const verification = await executeBatch(database, verifyProdDeployLeaseStatements());
    expect(() => assertProdDeployLeaseOwned(verification, OWNER_A)).toThrow(
      "must not have triggers",
    );
    expect(await readOwner(database)).toBe(OWNER_A);

    const release = await executeBatch(database, releaseProdDeployLeaseStatements(OWNER_A));
    expect(() => assertProdDeployLeaseReleased(release)).toThrow();
    expect(await readOwner(database)).toBe(OWNER_A);
  });
});
