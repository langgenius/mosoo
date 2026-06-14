import { type } from "arktype";

import { RunError } from "../session/session-run.contract";
import { NonEmptyString, parseSchemaValue } from "../validation/primitives.contract";

export const RuntimeCommandStatus = type(
  '"queued" | "delivered" | "accepted" | "completed" | "failed" | "expired" | "cancelled"',
);
export type RuntimeCommandStatus = typeof RuntimeCommandStatus.infer;

export const RuntimeCommandInput = type({
  "attachmentIds?": "string[]",
  text: NonEmptyString,
});
export type RuntimeCommandInput = typeof RuntimeCommandInput.infer;

export const TurnCancelCommand = type({
  commandId: NonEmptyString,
  kind: '"turn.cancel"',
  "reason?": "string",
});
export type TurnCancelCommand = typeof TurnCancelCommand.infer;

export const InputStartCommand = type({
  commandId: NonEmptyString,
  input: RuntimeCommandInput,
  kind: '"input.start"',
  "appAccessSnapshot?": type({
    entries: type({
      mountPath: NonEmptyString,
      role: '"admin" | "edit" | "read"',
      spaceId: NonEmptyString,
      type: '"space"',
    }).array(),
  }),
  requestId: NonEmptyString,
  runId: NonEmptyString,
});
export type InputStartCommand = typeof InputStartCommand.infer;

export const SessionStopCommand = type({
  commandId: NonEmptyString,
  kind: '"session.stop"',
  reason: NonEmptyString,
});
export type SessionStopCommand = typeof SessionStopCommand.infer;

export const McpExecuteCommand = type({
  argumentsJson: "string",
  commandId: NonEmptyString,
  kind: '"mcp.execute"',
  requestId: NonEmptyString,
  serverId: NonEmptyString,
  toolName: NonEmptyString,
});
export type McpExecuteCommand = typeof McpExecuteCommand.infer;

export const PermissionResolveCommand = type({
  commandId: NonEmptyString,
  decision: '"allow_once" | "reject_once"',
  kind: '"permission.resolve"',
  requestId: NonEmptyString,
});
export type PermissionResolveCommand = typeof PermissionResolveCommand.infer;

export const AccessRefreshCommand = type({
  commandId: NonEmptyString,
  kind: '"access.refresh"',
  appAccessSnapshot: type({
    entries: type({
      mountPath: NonEmptyString,
      role: '"admin" | "edit" | "read"',
      spaceId: NonEmptyString,
      type: '"space"',
    }).array(),
  }),
});
export type AccessRefreshCommand = typeof AccessRefreshCommand.infer;

export const RuntimeCommand = TurnCancelCommand.or(InputStartCommand)
  .or(McpExecuteCommand)
  .or(SessionStopCommand)
  .or(PermissionResolveCommand)
  .or(AccessRefreshCommand);
export type RuntimeCommand = typeof RuntimeCommand.infer;

export const InputStartCommandResult = type({
  requestId: NonEmptyString,
});
export type InputStartCommandResult = typeof InputStartCommandResult.infer;

export const McpExecuteCommandResult = type({
  outputText: "string",
  requestId: NonEmptyString,
  serverId: NonEmptyString,
  toolName: NonEmptyString,
});
export type McpExecuteCommandResult = typeof McpExecuteCommandResult.infer;

export const AccessRefreshCommandResult = type({
  entryCount: "number >= 0",
});
export type AccessRefreshCommandResult = typeof AccessRefreshCommandResult.infer;

export const RuntimeCommandResult = type("null")
  .or(AccessRefreshCommandResult)
  .or(InputStartCommandResult)
  .or(McpExecuteCommandResult);
export type RuntimeCommandResult = typeof RuntimeCommandResult.infer;

const runtimeCommandRecordBase = {
  ackedAt: "string | null",
  completedAt: "string | null",
  driverInstanceId: NonEmptyString,
  error: RunError.or("null"),
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
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"input.start"',
      payload: InputStartCommand,
      result: type("null").or(InputStartCommandResult),
    }),
  )
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"mcp.execute"',
      payload: McpExecuteCommand,
      result: type("null").or(McpExecuteCommandResult),
    }),
  )
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"session.stop"',
      payload: SessionStopCommand,
      result: "null",
    }),
  )
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"permission.resolve"',
      payload: PermissionResolveCommand,
      result: "null",
    }),
  )
  .or(
    type({
      ...runtimeCommandRecordBase,
      kind: '"access.refresh"',
      payload: AccessRefreshCommand,
      result: type("null").or(AccessRefreshCommandResult),
    }),
  );
export type RuntimeCommandRecord = typeof RuntimeCommandRecord.infer;

export function parseRuntimeCommand(value: unknown): RuntimeCommand {
  return parseSchemaValue(RuntimeCommand, value);
}
