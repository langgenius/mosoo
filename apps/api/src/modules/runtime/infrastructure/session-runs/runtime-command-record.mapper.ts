import { RuntimeCommandRecord } from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand, RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import type { DriverCommandId, DriverInstanceId } from "@mosoo/id";

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

export function toRuntimeCommandRecordFromRow(row: RuntimeCommandRecordRow): RuntimeCommandRecord {
  try {
    return parseSchemaValue(RuntimeCommandRecord, {
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
    });
  } catch (error) {
    if (error instanceof RuntimeCommandStoreCorruptionError) {
      throw error;
    }

    throw new RuntimeCommandStoreCorruptionError({
      cause: error,
      commandId: row.id,
      message: `Runtime command ${row.id} does not match the runtime command contract.`,
    });
  }
}
