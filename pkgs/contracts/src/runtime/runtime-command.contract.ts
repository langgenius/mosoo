import { type } from "arktype";

import { DURABLE_RUN_ERROR_MAX_UTF8_BYTES, DurableRunError } from "../session/session-run.contract";
import { NonEmptyString, parseSchemaValue } from "../validation/primitives.contract";

declare const TextEncoder: new () => { encode(input?: string): Uint8Array };

const D1_TABLE_ROW_MAX_UTF8_BYTES = 2_000_000;
const RUNTIME_COMMAND_ROW_RESERVED_UTF8_BYTES = 128 * 1_024;

/**
 * A driver_command row stores the command beside exactly one terminal payload.
 * The reserve covers every fixed column and SQLite record overhead below D1's
 * 2,000,000-byte row limit.
 */
export const RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES = DURABLE_RUN_ERROR_MAX_UTF8_BYTES;
export const RUNTIME_COMMAND_MAX_UTF8_BYTES =
  D1_TABLE_ROW_MAX_UTF8_BYTES -
  RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES -
  RUNTIME_COMMAND_ROW_RESERVED_UTF8_BYTES;

const runtimeCommandEncoder = new TextEncoder();

export function measureRuntimeCommandJson(value: unknown): number {
  return runtimeCommandEncoder.encode(JSON.stringify(value)).byteLength;
}

function withinRuntimeCommandLimit(
  value: unknown,
  limit: number,
  context: { reject(input: { actual: string; expected: string }): false },
) {
  const byteLength = measureRuntimeCommandJson(value);

  return byteLength <= limit
    ? true
    : context.reject({
        actual: `${byteLength} UTF-8 bytes`,
        expected: `at most ${limit} UTF-8 bytes`,
      });
}

export const RuntimeCommandStatus = type(
  '"queued" | "delivered" | "accepted" | "completed" | "failed" | "expired" | "cancelled"',
);
export type RuntimeCommandStatus = typeof RuntimeCommandStatus.infer;

export const RuntimeCommandInput = type({
  "attachmentIds?": NonEmptyString.array(),
  text: NonEmptyString,
}).onUndeclaredKey("reject");
export type RuntimeCommandInput = typeof RuntimeCommandInput.infer;

export const TurnCancelCommand = type({
  commandId: NonEmptyString,
  kind: '"turn.cancel"',
  "reason?": "string",
  runId: NonEmptyString,
}).onUndeclaredKey("reject");
export type TurnCancelCommand = typeof TurnCancelCommand.infer;

export const InputStartCommand = type({
  commandId: NonEmptyString,
  input: RuntimeCommandInput,
  kind: '"input.start"',
  requestId: NonEmptyString,
  runId: NonEmptyString,
}).onUndeclaredKey("reject");
export type InputStartCommand = typeof InputStartCommand.infer;

export const SessionStopCommand = type({
  commandId: NonEmptyString,
  kind: '"session.stop"',
  reason: NonEmptyString,
}).onUndeclaredKey("reject");
export type SessionStopCommand = typeof SessionStopCommand.infer;

export const McpExecuteCommand = type({
  argumentsJson: "string",
  commandId: NonEmptyString,
  kind: '"mcp.execute"',
  requestId: NonEmptyString,
  runId: NonEmptyString,
  serverId: NonEmptyString,
  toolCallId: NonEmptyString,
  toolName: NonEmptyString,
}).onUndeclaredKey("reject");
export type McpExecuteCommand = typeof McpExecuteCommand.infer;

export const PermissionResolveCommand = type({
  commandId: NonEmptyString,
  decision: '"allow_once" | "reject_once"',
  kind: '"permission.resolve"',
  requestId: NonEmptyString,
  runId: NonEmptyString,
}).onUndeclaredKey("reject");
export type PermissionResolveCommand = typeof PermissionResolveCommand.infer;

export const RuntimeCommand = TurnCancelCommand.or(InputStartCommand)
  .or(McpExecuteCommand)
  .or(SessionStopCommand)
  .or(PermissionResolveCommand)
  .narrow((command, context) =>
    withinRuntimeCommandLimit(command, RUNTIME_COMMAND_MAX_UTF8_BYTES, context),
  );
export type RuntimeCommand = typeof RuntimeCommand.infer;

export const InputStartCommandResult = type({
  requestId: NonEmptyString,
}).onUndeclaredKey("reject");
export type InputStartCommandResult = typeof InputStartCommandResult.infer;

export const McpExecuteCommandResult = type({
  "isError?": "boolean",
  outputText: "string",
  requestId: NonEmptyString,
  serverId: NonEmptyString,
  toolName: NonEmptyString,
})
  .onUndeclaredKey("reject")
  .narrow((result, context) =>
    withinRuntimeCommandLimit(result, RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES, context),
  );
export type McpExecuteCommandResult = typeof McpExecuteCommandResult.infer;

export const RuntimeCommandResult = type("null")
  .or(InputStartCommandResult)
  .or(McpExecuteCommandResult)
  .narrow((result, context) =>
    withinRuntimeCommandLimit(result, RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES, context),
  );
export type RuntimeCommandResult = typeof RuntimeCommandResult.infer;

const runtimeCommandRecordBase = {
  ackedAt: "string | null",
  completedAt: "string | null",
  driverInstanceId: NonEmptyString,
  error: DurableRunError.or("null"),
  expiresAt: "string | null",
  id: NonEmptyString,
  issuedAt: "string",
  seq: "number >= 0",
  status: RuntimeCommandStatus,
} as const;

export const RuntimeCommandRecord = type({
  ...runtimeCommandRecordBase,
  kind: '"turn.cancel"',
  payload: TurnCancelCommand,
  result: "null",
})
  .onUndeclaredKey("reject")
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"input.start"',
      payload: InputStartCommand,
      result: type("null").or(InputStartCommandResult),
    }).onUndeclaredKey("reject"),
  )
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"mcp.execute"',
      payload: McpExecuteCommand,
      result: type("null").or(McpExecuteCommandResult),
    }).onUndeclaredKey("reject"),
  )
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"session.stop"',
      payload: SessionStopCommand,
      result: "null",
    }).onUndeclaredKey("reject"),
  )
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"permission.resolve"',
      payload: PermissionResolveCommand,
      result: "null",
    }).onUndeclaredKey("reject"),
  )
  .narrow((record, context) => {
    const terminalPayloadMatchesStatus =
      record.result !== null
        ? record.status === "completed" && record.error === null
        : record.error !== null
          ? record.status !== "completed" &&
            ["failed", "expired", "cancelled"].includes(record.status)
          : true;
    if (!terminalPayloadMatchesStatus) {
      return context.reject({
        actual: `result=${record.result === null ? "null" : "present"}, error=${record.error === null ? "null" : "present"}, status=${record.status}`,
        expected: "result only for completed commands and error only for failed terminal commands",
      });
    }

    const payloadWithinLimit = withinRuntimeCommandLimit(
      record.payload,
      RUNTIME_COMMAND_MAX_UTF8_BYTES,
      context,
    );

    return payloadWithinLimit
      ? withinRuntimeCommandLimit(
          record.result,
          RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
          context,
        )
      : payloadWithinLimit;
  });
export type RuntimeCommandRecord = typeof RuntimeCommandRecord.infer;

export function parseRuntimeCommand(value: unknown): RuntimeCommand {
  return parseSchemaValue(RuntimeCommand, value);
}
