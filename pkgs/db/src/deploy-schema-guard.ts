import { Database } from "bun:sqlite";

import { applyDrizzleMigrations } from "../scripts/drizzle-migrations";

export interface ProdSchemaColumn {
  readonly defaultValue: string | null;
  readonly hidden: 0 | 1 | 2 | 3;
  readonly name: string;
  readonly notNull: boolean;
  readonly primaryKeyPosition: number;
  readonly type: string;
}

export interface ProdSchemaIndex {
  readonly columns: readonly string[];
  readonly name: string;
  readonly predicate: string | null;
  readonly unique: boolean;
}

export interface ProdSchemaForeignKey {
  readonly columnsFrom: readonly string[];
  readonly columnsTo: readonly string[];
  readonly onDelete: string;
  readonly onUpdate: string;
  readonly tableTo: string;
}

export interface ProdSchemaCheck {
  readonly expression: string;
}

export interface ProdSchemaTrigger {
  readonly name: string;
  readonly sql: string;
  readonly tableName: string;
}

export interface ProdSchemaTable {
  readonly autoincrement: boolean;
  readonly checks: readonly ProdSchemaCheck[];
  readonly columns: readonly ProdSchemaColumn[];
  readonly definition: string | null;
  readonly foreignKeys: readonly ProdSchemaForeignKey[];
  readonly indexes: readonly ProdSchemaIndex[];
  readonly name: string;
}

export interface ProdSchemaCatalog {
  readonly tables: readonly ProdSchemaTable[];
  readonly triggers: readonly ProdSchemaTrigger[];
}

type Row = Readonly<Record<string, unknown>>;

const PROD_SCHEMA_TABLE_INTROSPECTION_SQL = `SELECT name, sql
FROM sqlite_master
WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
ORDER BY name`;
const PROD_SCHEMA_TRIGGER_INTROSPECTION_SQL = `SELECT name, tbl_name AS table_name, sql
FROM sqlite_master
WHERE type = 'trigger'
ORDER BY name`;
const PROD_SCHEMA_INTROSPECTION_STATEMENT_COUNT = 5;
const PROD_SCHEMA_TABLES_PER_STATEMENT = 5;

interface ProdSchemaIntrospectionPlan {
  readonly statements: readonly string[];
  readonly tableChunkCount: number;
}

function schemaString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createProdSchemaIntrospectionPlan(
  tableNames: readonly string[],
): ProdSchemaIntrospectionPlan {
  const names = tableNames.toSorted();
  if (
    names.length === 0 ||
    new Set(names).size !== names.length ||
    names.some((name) => typeof name !== "string" || name.length === 0 || name.includes("\0"))
  ) {
    throw new Error("Production schema introspection requires unique table names.");
  }

  const chunks = Array.from(
    { length: Math.ceil(names.length / PROD_SCHEMA_TABLES_PER_STATEMENT) },
    (_, index) =>
      names.slice(
        index * PROD_SCHEMA_TABLES_PER_STATEMENT,
        (index + 1) * PROD_SCHEMA_TABLES_PER_STATEMENT,
      ),
  );

  return {
    statements: [
      PROD_SCHEMA_TABLE_INTROSPECTION_SQL,
      ...chunks.map((chunk) =>
        chunk
          .map((name) => {
            const table = schemaString(name);
            return `SELECT ${table} AS table_name, info.name, info.type,
info."notnull" AS not_null, info.dflt_value, info.pk, info.hidden
FROM pragma_table_xinfo(${table}) AS info`;
          })
          .join("\nUNION ALL\n"),
      ),
      ...chunks.map((chunk) =>
        chunk
          .map((name) => {
            const table = schemaString(name);
            return `SELECT ${table} AS table_name, indexes.name, indexes."unique" AS is_unique,
indexes.origin, indexes.partial, schema.sql
FROM pragma_index_list(${table}) AS indexes
LEFT JOIN sqlite_master AS schema
  ON schema.type = 'index' AND schema.name = indexes.name
WHERE indexes.origin <> 'pk'`;
          })
          .join("\nUNION ALL\n"),
      ),
      ...chunks.map((chunk) =>
        chunk
          .map((name) => {
            const table = schemaString(name);
            return `SELECT ${table} AS table_name, foreign_keys.id, foreign_keys.seq,
foreign_keys."table" AS table_to, foreign_keys."from" AS column_from,
foreign_keys."to" AS column_to, foreign_keys.on_update, foreign_keys.on_delete
FROM pragma_foreign_key_list(${table}) AS foreign_keys`;
          })
          .join("\nUNION ALL\n"),
      ),
      PROD_SCHEMA_TRIGGER_INTROSPECTION_SQL,
    ],
    tableChunkCount: chunks.length,
  };
}

export function createProdSchemaIntrospectionStatements(
  tableNames: readonly string[],
): readonly string[] {
  return createProdSchemaIntrospectionPlan(tableNames).statements;
}

interface SqlToken {
  readonly kind: "string" | "symbol" | "word";
  readonly value: string;
}

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];

  for (let index = 0; index < sql.length;) {
    const character = sql[index] ?? "";
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "'") {
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] !== "'") {
          index += 1;
          continue;
        }
        if (sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      if (sql[index - 1] !== "'") throw new Error("SQL contains an unterminated string literal.");
      tokens.push({ kind: "string", value: sql.slice(start, index) });
      continue;
    }
    if (character === '"' || character === "`" || character === "[") {
      const closing = character === "[" ? "]" : character;
      let value = "";
      index += 1;
      while (index < sql.length) {
        if (sql[index] !== closing) {
          value += sql[index];
          index += 1;
          continue;
        }
        if (character !== "[" && sql[index + 1] === closing) {
          value += closing;
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      if (sql[index - 1] !== closing) throw new Error("SQL contains an unterminated identifier.");
      tokens.push({ kind: "word", value: value.toLowerCase() });
      continue;
    }
    if (/[A-Za-z0-9_$]/u.test(character)) {
      const start = index;
      while (index < sql.length && /[A-Za-z0-9_$]/u.test(sql[index] ?? "")) index += 1;
      tokens.push({ kind: "word", value: sql.slice(start, index).toLowerCase() });
      continue;
    }

    const pair = sql.slice(index, index + 2);
    if (["!=", "<=", "<>", ">=", "||", "->"].includes(pair)) {
      tokens.push({ kind: "symbol", value: pair });
      index += 2;
      continue;
    }
    tokens.push({ kind: "symbol", value: character });
    index += 1;
  }

  return tokens;
}

export function normalizeSql(sql: string): string {
  return tokenizeSql(sql)
    .filter((token) => token.value !== ";")
    .map((token) => token.value)
    .join(" ");
}

function normalizeExpressionTokens(tokens: readonly SqlToken[], tableName: string): string {
  const normalized: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.value === tableName.toLowerCase() && tokens[index + 1]?.value === ".") {
      index += 1;
      continue;
    }
    const value = tokens[index]?.value;
    normalized.push(value === "true" ? "1" : value === "false" ? "0" : (value ?? ""));
  }
  return normalized.filter((value) => value !== ";").join(" ");
}

function normalizeExpression(sql: string, tableName: string): string {
  return normalizeExpressionTokens(tokenizeSql(sql), tableName);
}

function extractChecks(sql: string, tableName: string): ProdSchemaCheck[] {
  const tokens = tokenizeSql(sql);
  const checks: ProdSchemaCheck[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.kind !== "word" || tokens[index]?.value !== "check") continue;
    if (tokens[index + 1]?.value !== "(") throw new Error("CHECK is missing its expression.");

    let depth = 1;
    let end = index + 2;
    while (end < tokens.length && depth > 0) {
      if (tokens[end]?.value === "(") depth += 1;
      if (tokens[end]?.value === ")") depth -= 1;
      end += 1;
    }
    if (depth !== 0) throw new Error("CHECK contains unbalanced parentheses.");

    checks.push({
      expression: normalizeExpressionTokens(tokens.slice(index + 2, end - 1), tableName),
    });
    index = end - 1;
  }

  return checks.toSorted((left, right) => left.expression.localeCompare(right.expression));
}

function indexPredicate(sql: string | null, tableName: string): string | null {
  if (sql === null) return null;
  const tokens = tokenizeSql(sql);
  const where = tokens.findIndex((token) => token.kind === "word" && token.value === "where");
  return where === -1 ? null : normalizeExpressionTokens(tokens.slice(where + 1), tableName);
}

function indexColumns(sql: string, tableName: string): string[] {
  const tokens = tokenizeSql(sql);
  const on = tokens.findIndex((token) => token.kind === "word" && token.value === "on");
  if (on === -1 || tokens[on + 2]?.value !== "(") {
    throw new Error(`Schema index on ${tableName} is missing its key columns.`);
  }

  const columns: string[] = [];
  let depth = 1;
  let start = on + 3;
  for (let index = start; index < tokens.length; index += 1) {
    const value = tokens[index]?.value;
    if (value === "(") depth += 1;
    if (value === ")") depth -= 1;
    if ((value === "," && depth === 1) || depth === 0) {
      const column = normalizeExpressionTokens(tokens.slice(start, index), tableName);
      if (!column) throw new Error(`Schema index on ${tableName} contains an empty key.`);
      columns.push(column);
      start = index + 1;
    }
    if (depth === 0) return columns;
  }
  throw new Error(`Schema index on ${tableName} contains unbalanced parentheses.`);
}

function requireString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Schema field ${key} must be a string.`);
  return value;
}

function requireNullableString(row: Row, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new Error(`Schema field ${key} must be a string or null.`);
  }
  return value;
}

function requireInteger(row: Row, key: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value)) throw new Error(`Schema field ${key} must be an integer.`);
  return value as number;
}

function requireBit(row: Row, key: string): boolean {
  const value = requireInteger(row, key);
  if (value !== 0 && value !== 1) throw new Error(`Schema field ${key} must be 0 or 1.`);
  return value === 1;
}

function requireHiddenColumnKind(row: Row): 0 | 1 | 2 | 3 {
  const value = requireInteger(row, "hidden");
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    throw new Error("Schema field hidden must be between 0 and 3.");
  }
  return value;
}

function requireRows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error("Schema introspection result must be an array.");
  return value.map((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("Schema introspection row must be an object.");
    }
    return row as Row;
  });
}

function aggregateProdSchemaIntrospectionRows(
  statementRows: readonly unknown[],
  tableNames: readonly string[],
): Row[][] {
  const { statements, tableChunkCount } = createProdSchemaIntrospectionPlan(tableNames);
  if (statementRows.length !== statements.length) {
    throw new Error("Schema introspection has an unexpected statement count.");
  }
  const rows = statementRows.map(requireRows);
  const indexStart = 1 + tableChunkCount;
  const foreignKeyStart = indexStart + tableChunkCount;
  const triggerIndex = foreignKeyStart + tableChunkCount;
  return [
    rows[0] ?? [],
    rows.slice(1, indexStart).flat(),
    rows.slice(indexStart, foreignKeyStart).flat(),
    rows.slice(foreignKeyStart, triggerIndex).flat(),
    rows[triggerIndex] ?? [],
  ];
}

export function createProdSchemaCatalogFromIntrospectionRows(
  statementRows: readonly unknown[],
  tableNames: readonly string[],
): ProdSchemaCatalog {
  return createProdSchemaCatalog(aggregateProdSchemaIntrospectionRows(statementRows, tableNames));
}

export function parseGeneratedProdSchemaCatalog(raw: string): ProdSchemaCatalog {
  const catalog = createProdSchemaCatalogFromDrizzleSnapshot(JSON.parse(raw));
  const definitions = new Map(
    DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG.tables.map(({ definition, name }) => [name, definition]),
  );
  return {
    ...catalog,
    tables: catalog.tables.map((table) => {
      const definition = definitions.get(table.name);
      if (definition === undefined || definition === null) {
        throw new Error(`Drizzle snapshot table ${table.name} has no migration definition.`);
      }
      return Object.assign(table, { definition });
    }),
  };
}

export function createProdSchemaCatalog(statementRows: readonly unknown[]): ProdSchemaCatalog {
  if (statementRows.length !== PROD_SCHEMA_INTROSPECTION_STATEMENT_COUNT) {
    throw new Error("Schema introspection has an unexpected statement count.");
  }
  const [tableRows, columnRows, indexRows, foreignKeyRows, triggerRows] =
    statementRows.map(requireRows);
  if (!tableRows || !columnRows || !indexRows || !foreignKeyRows || !triggerRows) {
    throw new Error("Schema introspection is incomplete.");
  }

  const columnsByTable = Map.groupBy(columnRows, (row) => requireString(row, "table_name"));
  const indexesByTable = Map.groupBy(indexRows, (row) => requireString(row, "table_name"));
  const foreignKeysByTable = Map.groupBy(foreignKeyRows, (row) => requireString(row, "table_name"));
  const seenTables = new Set<string>();

  const tables = tableRows.map((tableRow): ProdSchemaTable => {
    const name = requireString(tableRow, "name");
    const sql = requireString(tableRow, "sql");
    if (seenTables.has(name)) throw new Error(`Schema contains duplicate table ${name}.`);
    seenTables.add(name);

    const seenColumns = new Set<string>();
    const columns = (columnsByTable.get(name) ?? []).map((row): ProdSchemaColumn => {
      const columnName = requireString(row, "name");
      if (seenColumns.has(columnName)) {
        throw new Error(`Schema table ${name} contains duplicate column ${columnName}.`);
      }
      seenColumns.add(columnName);
      const defaultValue = requireNullableString(row, "dflt_value");
      return {
        defaultValue: defaultValue === null ? null : normalizeExpression(defaultValue, name),
        hidden: requireHiddenColumnKind(row),
        name: columnName,
        notNull: requireBit(row, "not_null"),
        primaryKeyPosition: requireInteger(row, "pk"),
        type: normalizeSql(requireString(row, "type")),
      };
    });

    const indexes = (indexesByTable.get(name) ?? []).map((row): ProdSchemaIndex => {
      const indexName = requireString(row, "name");
      if (requireString(row, "origin") !== "c") {
        throw new Error(`Schema table ${name} contains unsupported inline UNIQUE constraints.`);
      }
      const sqlValue = requireNullableString(row, "sql");
      if (sqlValue === null) throw new Error(`Schema index ${indexName} has no SQL definition.`);
      const partial = requireBit(row, "partial");
      const predicate = indexPredicate(sqlValue, name);
      if (partial !== (predicate !== null)) {
        throw new Error(`Schema index ${indexName} has inconsistent partial-index metadata.`);
      }
      return {
        columns: indexColumns(sqlValue, name),
        name: indexName,
        predicate,
        unique: requireBit(row, "is_unique"),
      };
    });

    const foreignKeyGroups = Map.groupBy(foreignKeysByTable.get(name) ?? [], (row) =>
      requireInteger(row, "id"),
    );
    const foreignKeys = [...foreignKeyGroups.values()].map((rows): ProdSchemaForeignKey => {
      const ordered = rows.toSorted(
        (left, right) => requireInteger(left, "seq") - requireInteger(right, "seq"),
      );
      const first = ordered[0];
      if (!first) throw new Error(`Schema table ${name} contains an empty foreign key.`);
      for (const [position, row] of ordered.entries()) {
        if (requireInteger(row, "seq") !== position) {
          throw new Error(`Schema table ${name} contains a non-contiguous foreign key.`);
        }
      }
      return {
        columnsFrom: ordered.map((row) => requireString(row, "column_from")),
        columnsTo: ordered.map((row) => requireString(row, "column_to")),
        onDelete: requireString(first, "on_delete").toLowerCase(),
        onUpdate: requireString(first, "on_update").toLowerCase(),
        tableTo: requireString(first, "table_to"),
      };
    });

    return {
      autoincrement: tokenizeSql(sql).some((token) => token.value === "autoincrement"),
      checks: extractChecks(sql, name),
      columns: columns.toSorted((left, right) => left.name.localeCompare(right.name)),
      definition: normalizeSql(sql),
      foreignKeys: foreignKeys.toSorted((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
      indexes: indexes.toSorted((left, right) => left.name.localeCompare(right.name)),
      name,
    };
  });

  const triggers = triggerRows.map((row): ProdSchemaTrigger => ({
    name: requireString(row, "name"),
    sql: requireString(row, "sql"),
    tableName: requireString(row, "table_name"),
  }));

  return {
    tables: tables.toSorted((left, right) => left.name.localeCompare(right.name)),
    triggers: triggers.toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return value as string[];
}

function snapshotDefault(column: Record<string, unknown>, tableName: string): string | null {
  if (!("default" in column)) return null;
  const value = column["default"];
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error(`Drizzle column default in ${tableName} is invalid.`);
  }
  return normalizeExpression(String(value), tableName);
}

function snapshotHiddenColumnKind(
  column: Record<string, unknown>,
  tableName: string,
  columnName: string,
): 0 | 2 | 3 {
  if (!("generated" in column)) return 0;
  const generated = requireObject(
    column["generated"],
    `Drizzle generated column ${tableName}.${columnName}`,
  );
  if (typeof generated["as"] !== "string") {
    throw new Error(`Drizzle generated column ${tableName}.${columnName} has no expression.`);
  }
  if (generated["type"] === "virtual") return 2;
  if (generated["type"] === "stored") return 3;
  throw new Error(`Drizzle generated column ${tableName}.${columnName} has an invalid mode.`);
}

export function createProdSchemaCatalogFromDrizzleSnapshot(value: unknown): ProdSchemaCatalog {
  const snapshot = requireObject(value, "Drizzle snapshot");
  const snapshotTables = requireObject(snapshot["tables"], "Drizzle snapshot tables");
  if (Object.keys(snapshotTables).length === 0) throw new Error("Drizzle snapshot has no tables.");

  const tables = Object.entries(snapshotTables).map(([tableKey, rawTable]): ProdSchemaTable => {
    const table = requireObject(rawTable, `Drizzle table ${tableKey}`);
    const name = table["name"];
    if (name !== tableKey)
      throw new Error(`Drizzle table key ${tableKey} does not match its name.`);
    const snapshotColumns = requireObject(table["columns"], `Drizzle columns for ${name}`);
    if (
      Object.keys(
        requireObject(table["uniqueConstraints"], `Drizzle unique constraints for ${name}`),
      ).length > 0
    ) {
      throw new Error(`Drizzle table ${name} contains unsupported inline UNIQUE constraints.`);
    }
    const compositePrimaryKeys = Object.values(
      requireObject(table["compositePrimaryKeys"], `Drizzle primary keys for ${name}`),
    );
    if (compositePrimaryKeys.length > 1) {
      throw new Error(`Drizzle table ${name} contains multiple composite primary keys.`);
    }
    const compositeColumns =
      compositePrimaryKeys.length === 0
        ? []
        : requireStringArray(
            requireObject(compositePrimaryKeys[0], `Drizzle primary key for ${name}`)["columns"],
            `Drizzle primary key columns for ${name}`,
          );

    const checks: ProdSchemaCheck[] = [];
    const columns = Object.entries(snapshotColumns).map(
      ([columnKey, rawColumn]): ProdSchemaColumn => {
        const column = requireObject(rawColumn, `Drizzle column ${name}.${columnKey}`);
        if (column["name"] !== columnKey) {
          throw new Error(`Drizzle column key ${name}.${columnKey} does not match its name.`);
        }
        const declaredType = column["type"];
        if (typeof declaredType !== "string") {
          throw new Error(`Drizzle column ${name}.${columnKey} has no type.`);
        }
        checks.push(...extractChecks(declaredType, name));
        const typeTokens = tokenizeSql(declaredType);
        const checkIndex = typeTokens.findIndex(
          (token) => token.kind === "word" && token.value === "check",
        );
        const type = (checkIndex === -1 ? typeTokens : typeTokens.slice(0, checkIndex))
          .map((token) => token.value)
          .join(" ");
        const primaryKey = requireBoolean(
          column["primaryKey"],
          `Drizzle primary-key flag for ${name}.${columnKey}`,
        );
        const compositePosition = compositeColumns.indexOf(columnKey);
        if (primaryKey && compositePosition !== -1) {
          throw new Error(`Drizzle column ${name}.${columnKey} has conflicting primary keys.`);
        }
        return {
          defaultValue: snapshotDefault(column, name),
          hidden: snapshotHiddenColumnKind(column, name, columnKey),
          name: columnKey,
          notNull: requireBoolean(
            column["notNull"],
            `Drizzle nullability for ${name}.${columnKey}`,
          ),
          primaryKeyPosition: primaryKey ? 1 : compositePosition === -1 ? 0 : compositePosition + 1,
          type,
        };
      },
    );

    for (const rawCheck of Object.values(
      requireObject(table["checkConstraints"], `Drizzle checks for ${name}`),
    )) {
      const check = requireObject(rawCheck, `Drizzle check for ${name}`);
      if (typeof check["value"] !== "string") {
        throw new Error(`Drizzle check for ${name} has no expression.`);
      }
      checks.push({ expression: normalizeExpression(check["value"], name) });
    }

    const indexes = Object.entries(
      requireObject(table["indexes"], `Drizzle indexes for ${name}`),
    ).map(([indexKey, rawIndex]): ProdSchemaIndex => {
      const index = requireObject(rawIndex, `Drizzle index ${indexKey}`);
      if (index["name"] !== indexKey) {
        throw new Error(`Drizzle index key ${indexKey} does not match its name.`);
      }
      const where = index["where"];
      if (where !== undefined && typeof where !== "string") {
        throw new Error(`Drizzle index ${indexKey} has an invalid predicate.`);
      }
      return {
        columns: requireStringArray(index["columns"], `Drizzle index columns for ${indexKey}`).map(
          (column) => normalizeExpression(column, name),
        ),
        name: indexKey,
        predicate: where === undefined ? null : normalizeExpression(where, name),
        unique: requireBoolean(index["isUnique"], `Drizzle uniqueness for ${indexKey}`),
      };
    });

    const foreignKeys = Object.values(
      requireObject(table["foreignKeys"], `Drizzle foreign keys for ${name}`),
    ).map((rawForeignKey): ProdSchemaForeignKey => {
      const foreignKey = requireObject(rawForeignKey, `Drizzle foreign key for ${name}`);
      if (
        typeof foreignKey["tableTo"] !== "string" ||
        typeof foreignKey["onDelete"] !== "string" ||
        typeof foreignKey["onUpdate"] !== "string"
      ) {
        throw new Error(`Drizzle foreign key for ${name} is incomplete.`);
      }
      return {
        columnsFrom: requireStringArray(
          foreignKey["columnsFrom"],
          `Drizzle foreign-key source columns for ${name}`,
        ),
        columnsTo: requireStringArray(
          foreignKey["columnsTo"],
          `Drizzle foreign-key target columns for ${name}`,
        ),
        onDelete: foreignKey["onDelete"],
        onUpdate: foreignKey["onUpdate"],
        tableTo: foreignKey["tableTo"],
      };
    });

    return {
      autoincrement: Object.values(snapshotColumns).some(
        (rawColumn) =>
          requireObject(rawColumn, `Drizzle column for ${name}`)["autoincrement"] === true,
      ),
      checks: checks.toSorted((left, right) => left.expression.localeCompare(right.expression)),
      columns: columns.toSorted((left, right) => left.name.localeCompare(right.name)),
      definition: null,
      foreignKeys: foreignKeys.toSorted((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
      indexes: indexes.toSorted((left, right) => left.name.localeCompare(right.name)),
      name,
    };
  });

  return {
    tables: tables.toSorted((left, right) => left.name.localeCompare(right.name)),
    triggers: MANAGED_PROD_SCHEMA_TRIGGERS,
  };
}

// The Channels and App Deployment subsystems were removed by #577 and #591
// without destructive data migrations.
const RETAINED_LEGACY_TABLES = new Set([
  "agent_channel_binding",
  "bound_agent_call_idempotency_key",
  "channel_event_receipt",
  "channel_final_delivery_job",
  "channel_runtime_state",
  "channel_thread_session",
  "project_deployment",
  "project_deployment_run",
  "project_deployment_secret",
  "wechat_channel_account",
  "wechat_channel_pairing",
  "wechat_context_token",
]);

const RETIRED_SESSION_RUN_COLUMNS = new Set([
  "bound_capability_agent_id",
  "bound_capability_project_id",
  "bound_capability_binding_env",
  "bound_capability_binding_name",
  "bound_capability_deployment_id",
  "bound_capability_deployment_run_id",
]);

function runtimeComparableTable(table: ProdSchemaTable): ProdSchemaTable {
  if (table.name !== "session_run") return table;
  return {
    ...table,
    checks: table.checks.filter(
      ({ expression }) =>
        ![...RETIRED_SESSION_RUN_COLUMNS].some((column) => expression.includes(column)),
    ),
    columns: table.columns.filter(({ name }) => !RETIRED_SESSION_RUN_COLUMNS.has(name)),
  };
}

const PROTOCOL_V3_CUTOVER_TRIGGER_PREFIX = "__protocol_v3_cutover_";
export const PROTOCOL_V3_MIGRATION_INTENT_TABLE = "__protocol_v3_migration_intent";
export const PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL = `CREATE TABLE "${PROTOCOL_V3_MIGRATION_INTENT_TABLE}" (
  "id" integer PRIMARY KEY CHECK ("id" = 1) REFERENCES "__protocol_v3_cutover" ("id") ON DELETE CASCADE,
  "started_at" integer NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
)`;
const normalizedProtocolV3MigrationIntentTableSql = normalizeSql(
  PROTOCOL_V3_MIGRATION_INTENT_TABLE_SQL,
);

function isProtocolV3CutoverTrigger({ name }: ProdSchemaTrigger): boolean {
  return name.startsWith(PROTOCOL_V3_CUTOVER_TRIGGER_PREFIX);
}

function loadDrizzleMigrationSchemaCatalog(): ProdSchemaCatalog {
  const database = new Database(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    applyDrizzleMigrations({ execute: (sql) => database.exec(sql) });
    const tableNames = database
      .prepare<Row, []>(PROD_SCHEMA_TABLE_INTROSPECTION_SQL)
      .all()
      .map((row) => requireString(row, "name"));
    return createProdSchemaCatalogFromIntrospectionRows(
      createProdSchemaIntrospectionStatements(tableNames).map((statement) =>
        database.prepare(statement).all(),
      ),
      tableNames,
    );
  } finally {
    database.close();
  }
}

export const DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG = loadDrizzleMigrationSchemaCatalog();

const transientProdSchemaTriggers = new Map(
  DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG.triggers
    .filter(isProtocolV3CutoverTrigger)
    .map((trigger) => [trigger.name, trigger]),
);

export const MANAGED_PROD_SCHEMA_TRIGGERS = DRIZZLE_MIGRATION_PROD_SCHEMA_CATALOG.triggers.filter(
  (trigger) => !isProtocolV3CutoverTrigger(trigger),
);

function prodSchemaTriggersMatch(left: ProdSchemaTrigger, right: ProdSchemaTrigger): boolean {
  return left.tableName === right.tableName && normalizeSql(left.sql) === normalizeSql(right.sql);
}

export function findProdSchemaDifferences(
  expected: ProdSchemaCatalog,
  live: ProdSchemaCatalog,
): string[] {
  const expectedTables = new Map(
    expected.tables.map((table) => [table.name, runtimeComparableTable(table)]),
  );
  const liveTables = new Map(live.tables.map((table) => [table.name, table]));
  const differences: string[] = [];

  for (const [name, expectedTable] of expectedTables) {
    const rawLiveTable = liveTables.get(name);
    if (!rawLiveTable) {
      differences.push(`missing table ${name}`);
      continue;
    }
    const liveTable = runtimeComparableTable(rawLiveTable);
    for (const field of ["columns", "indexes", "foreignKeys", "checks", "autoincrement"] as const) {
      if (JSON.stringify(expectedTable[field]) !== JSON.stringify(liveTable[field])) {
        differences.push(`${name}.${field} differs`);
      }
    }
    if (expectedTable.definition !== null && expectedTable.definition !== liveTable.definition) {
      differences.push(`${name}.definition differs`);
    }
  }

  for (const [name, liveTable] of liveTables) {
    const normalized = name.toLowerCase();
    if (normalized === PROTOCOL_V3_MIGRATION_INTENT_TABLE) {
      if (
        name !== PROTOCOL_V3_MIGRATION_INTENT_TABLE ||
        liveTable.definition !== normalizedProtocolV3MigrationIntentTableSql
      ) {
        differences.push(`${name}.definition differs`);
      }
      continue;
    }
    const isInternal =
      normalized === "d1_migrations" ||
      normalized === "__production_deploy_lease" ||
      normalized === "__protocol_v3_cutover" ||
      normalized.startsWith("_cf_") ||
      normalized.startsWith("sqlite_");
    if (!expectedTables.has(name) && !isInternal && !RETAINED_LEGACY_TABLES.has(name)) {
      differences.push(`unexpected table ${name}`);
    }
  }

  const expectedTriggers = new Map(expected.triggers.map((trigger) => [trigger.name, trigger]));
  const liveTriggers = new Map(live.triggers.map((trigger) => [trigger.name, trigger]));
  for (const [name, expectedTrigger] of expectedTriggers) {
    const liveTrigger = liveTriggers.get(name);
    if (!liveTrigger) {
      differences.push(`missing trigger ${name}`);
    } else if (!prodSchemaTriggersMatch(liveTrigger, expectedTrigger)) {
      differences.push(`trigger ${name} differs`);
    }
  }
  for (const [name, trigger] of liveTriggers) {
    if (expectedTriggers.has(name) || trigger.tableName.toLowerCase().startsWith("_cf_")) continue;
    const transientTrigger = transientProdSchemaTriggers.get(name);
    if (transientTrigger !== undefined) {
      if (!prodSchemaTriggersMatch(trigger, transientTrigger)) {
        differences.push(`trigger ${name} differs`);
      }
    } else {
      differences.push(`unexpected trigger ${name}`);
    }
  }
  return differences;
}

export function assertProdSchemaMatches(
  expected: ProdSchemaCatalog,
  live: ProdSchemaCatalog,
): void {
  const differences = findProdSchemaDifferences(expected, live);
  if (differences.length === 0) return;
  throw new Error(
    `Prod D1 schema differs from the latest Drizzle snapshot:\n${differences
      .slice(0, 20)
      .map((difference) => `  - ${difference}`)
      .join("\n")}${differences.length > 20 ? `\n  - …and ${differences.length - 20} more` : ""}`,
  );
}
