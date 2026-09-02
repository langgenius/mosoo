import { RuntimeCommandRecord } from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand, RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";
import { DurableRunError } from "@mosoo/contracts/session-run";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import { NonEmptyString } from "@mosoo/contracts/validation";
import type { DriverCommandId, DriverInstanceId } from "@mosoo/id";
import { type } from "arktype";

import { toIsoString } from "../../../../time";

class RuntimeCommandStoreCorruptionError extends Error {
  readonly commandId: DriverCommandId;
  readonly column: string | null;

  constructor(input: {
    cause: unknown;
    column?: string;
    commandId: DriverCommandId;
    message: string;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "RuntimeCommandStoreCorruptionError";
    this.column = input.column ?? null;
    this.commandId = input.commandId;
  }
}

export interface RuntimeCommandRecordRow {
  ackedAt: number | null;
  completedAt: number | null;
  driverGeneration: number | null;
  driverInstanceId: DriverInstanceId;
  errorJson: string | null;
  expiresAt: number | null;
  id: DriverCommandId;
  issuedAt: number;
  kind: RuntimeCommand["kind"];
  payloadJson: string;
  resultJson: string | null;
  seq: number;
  status: RuntimeCommandStatus;
}

const legacyTerminalRuntimeCommandRecordBase = {
  ackedAt: "string | null",
  completedAt: "string | null",
  driverInstanceId: NonEmptyString,
  error: DurableRunError.or("null"),
  expiresAt: "string | null",
  id: NonEmptyString,
  issuedAt: "string",
  seq: "number >= 0",
  status: '"completed" | "failed" | "expired" | "cancelled"',
} as const;

const LegacyTerminalRuntimeCommandRecord = type({
  ...legacyTerminalRuntimeCommandRecordBase,
  kind: '"turn.cancel"',
  payload: type({
    commandId: NonEmptyString,
    kind: '"turn.cancel"',
    "reason?": "string",
  }).onUndeclaredKey("reject"),
  result: "null",
})
  .onUndeclaredKey("reject")
  .or(
    type({
      ...legacyTerminalRuntimeCommandRecordBase,
      kind: '"permission.resolve"',
      payload: type({
        commandId: NonEmptyString,
        decision: '"allow_once" | "reject_once"',
        kind: '"permission.resolve"',
        requestId: NonEmptyString,
      }).onUndeclaredKey("reject"),
      result: "null",
    }).onUndeclaredKey("reject"),
  );
export type LegacyTerminalRuntimeCommandRecord = typeof LegacyTerminalRuntimeCommandRecord.infer;

export type RuntimeCommandStorageRecord =
  | {
      driverGeneration: number;
      format: "v3";
      record: RuntimeCommandRecord;
    }
  | {
      driverGeneration: null;
      format: "legacy-v2-terminal";
      record: LegacyTerminalRuntimeCommandRecord | RuntimeCommandRecord;
    };

type RuntimeCommandJsonColumn = "errorJson" | "payloadJson" | "resultJson";

function readRuntimeCommandJsonRaw(
  row: RuntimeCommandRecordRow,
  column: RuntimeCommandJsonColumn,
): string | null {
  switch (column) {
    case "errorJson": {
      return row.errorJson;
    }
    case "payloadJson": {
      return row.payloadJson;
    }
    case "resultJson": {
      return row.resultJson;
    }
    default: {
      return throwUnsupportedRuntimeCommandJsonColumn(row, column);
    }
  }
}

function throwUnsupportedRuntimeCommandJsonColumn(
  row: RuntimeCommandRecordRow,
  _column: never,
): never {
  throw new RuntimeCommandStoreCorruptionError({
    cause: new Error("Unsupported runtime command JSON column."),
    commandId: row.id,
    message: `Runtime command ${row.id} requested an unsupported JSON column.`,
  });
}

function parseRuntimeCommandJsonColumn(
  row: RuntimeCommandRecordRow,
  column: RuntimeCommandJsonColumn,
): unknown {
  const raw = readRuntimeCommandJsonRaw(row, column);

  if (raw === null) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new RuntimeCommandStoreCorruptionError({
      cause: error,
      column,
      commandId: row.id,
      message: `Runtime command ${row.id} has invalid JSON in ${column}.`,
    });
  }
}

export function toRuntimeCommandStorageRecordFromRow(
  row: RuntimeCommandRecordRow,
): RuntimeCommandStorageRecord {
  try {
    const recordInput = {
      ackedAt: row.ackedAt === null ? null : toIsoString(row.ackedAt),
      completedAt: row.completedAt === null ? null : toIsoString(row.completedAt),
      driverInstanceId: row.driverInstanceId,
      error: row.errorJson === null ? null : parseRuntimeCommandJsonColumn(row, "errorJson"),
      expiresAt: row.expiresAt === null ? null : toIsoString(row.expiresAt),
      id: row.id,
      issuedAt: toIsoString(row.issuedAt),
      kind: row.kind,
      payload: parseRuntimeCommandJsonColumn(row, "payloadJson"),
      result: row.resultJson === null ? null : parseRuntimeCommandJsonColumn(row, "resultJson"),
      seq: row.seq,
      status: row.status,
    };

    if (
      (recordInput.result !== null && recordInput.error !== null) ||
      (recordInput.result !== null && recordInput.status !== "completed") ||
      (recordInput.error !== null && recordInput.status === "completed") ||
      ((recordInput.result !== null || recordInput.error !== null) &&
        !["completed", "failed", "expired", "cancelled"].includes(recordInput.status))
    ) {
      throw new TypeError("Runtime command terminal payload does not match its stored status.");
    }

    if (row.driverGeneration === null) {
      if (!["completed", "failed", "expired", "cancelled"].includes(row.status)) {
        throw new TypeError("Only terminal legacy runtime commands may omit driver generation.");
      }

      if (!LegacyTerminalRuntimeCommandRecord.allows(recordInput)) {
        return {
          driverGeneration: null,
          format: "legacy-v2-terminal",
          record: parseSchemaValue(RuntimeCommandRecord, recordInput),
        };
      }

      return {
        driverGeneration: null,
        format: "legacy-v2-terminal",
        record: parseSchemaValue(LegacyTerminalRuntimeCommandRecord, recordInput),
      };
    }

    if (!Number.isSafeInteger(row.driverGeneration) || row.driverGeneration < 0) {
      throw new TypeError("Runtime command driver generation is invalid.");
    }

    return {
      driverGeneration: row.driverGeneration,
      format: "v3",
      record: parseSchemaValue(RuntimeCommandRecord, recordInput),
    };
  } catch (error) {
    if (error instanceof RuntimeCommandStoreCorruptionError) {
      throw error;
    }

    throw new RuntimeCommandStoreCorruptionError({
      cause: error,
      commandId: row.id,
      message: `Runtime command ${row.id} does not match a supported storage contract.`,
    });
  }
}
