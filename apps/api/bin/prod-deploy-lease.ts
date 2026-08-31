import { parseD1JsonResults } from "./d1-json";

export const PROD_DEPLOY_LEASE_TABLE = "__production_deploy_lease";

export const PROD_DEPLOY_LEASE_TABLE_SQL = `CREATE TABLE "${PROD_DEPLOY_LEASE_TABLE}" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "owner" text NOT NULL
)`;

function ownerSql(owner: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(owner)) {
    throw new Error("Production deploy lease owner must be a UUID v4.");
  }
  return `'${owner}'`;
}

const LEASE_READBACK_SQL = `(SELECT "sql" FROM "sqlite_master"
    WHERE "type" = 'table' AND "name" = '${PROD_DEPLOY_LEASE_TABLE}')`;
const LEASE_TRIGGER_COUNT_SQL = `(SELECT count(*) FROM "sqlite_master"
    WHERE "type" = 'trigger' AND "tbl_name" = '${PROD_DEPLOY_LEASE_TABLE}' COLLATE BINARY)`;
const LEASE_SCHEMA_PREDICATE_SQL = `${LEASE_READBACK_SQL} = '${PROD_DEPLOY_LEASE_TABLE_SQL.replaceAll("'", "''")}' COLLATE BINARY
  AND ${LEASE_TRIGGER_COUNT_SQL} = 0`;
const LEASE_FINAL_READ_SQL = `SELECT
  "lease"."owner",
  ${LEASE_READBACK_SQL} AS "table_sql",
  ${LEASE_TRIGGER_COUNT_SQL} AS "trigger_count"
FROM (SELECT 1) AS "singleton"
LEFT JOIN "${PROD_DEPLOY_LEASE_TABLE}" AS "lease" ON "lease"."id" = 1`;

export function acquireProdDeployLeaseStatements(owner: string): readonly string[] {
  const quotedOwner = ownerSql(owner);
  return [
    PROD_DEPLOY_LEASE_TABLE_SQL.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS"),
    `INSERT INTO "${PROD_DEPLOY_LEASE_TABLE}" ("id", "owner")
SELECT 1, ${quotedOwner}
WHERE ${LEASE_SCHEMA_PREDICATE_SQL}
ON CONFLICT ("id") DO NOTHING`,
    LEASE_FINAL_READ_SQL,
  ];
}

export function verifyProdDeployLeaseStatements(): readonly string[] {
  return [LEASE_FINAL_READ_SQL];
}

export function releaseProdDeployLeaseStatements(owner: string): readonly string[] {
  return [
    `DELETE FROM "${PROD_DEPLOY_LEASE_TABLE}"
WHERE "id" = 1 AND "owner" = ${ownerSql(owner)}
  AND ${LEASE_SCHEMA_PREDICATE_SQL}`,
    `SELECT "owner" FROM "${PROD_DEPLOY_LEASE_TABLE}" WHERE "id" = 1`,
  ];
}

export function assertProdDeployLeaseOwned(raw: string, owner: string): void {
  ownerSql(owner);
  const statements = parseD1JsonResults(raw);
  const readback = statements.length === 1 || statements.length === 3 ? statements.at(-1) : null;
  const row = readback?.length === 1 ? readback[0] : undefined;
  if (row?.table_sql !== PROD_DEPLOY_LEASE_TABLE_SQL) {
    throw new Error("Production deploy lease table schema is invalid.");
  }
  if (row.trigger_count !== 0) {
    throw new Error("Production deploy lease table must not have triggers.");
  }
  if (row.owner !== owner) throw new Error("Production deploy lease is held by another owner.");
}

function releaseReadback(raw: string) {
  const statements = parseD1JsonResults(raw);
  return statements.length === 2 ? statements[1] : undefined;
}

export function assertProdDeployLeaseReleased(raw: string): void {
  const remaining = releaseReadback(raw);
  if (!remaining || remaining.length !== 0) {
    throw new Error("Production deploy lease release did not remove this owner.");
  }
}
