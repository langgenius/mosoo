import { type } from "arktype";

import { NonEmptyString } from "../validation/primitives.contract";

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
  runId: NonEmptyString,
});
export type TurnCancelCommand = typeof TurnCancelCommand.infer;

export const InputStartCommand = type({
  commandId: NonEmptyString,
  input: RuntimeCommandInput,
  kind: '"input.start"',
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
  runId: NonEmptyString,
  serverId: NonEmptyString,
  toolCallId: NonEmptyString,
  toolName: NonEmptyString,
});
export type McpExecuteCommand = typeof McpExecuteCommand.infer;

export const PermissionResolveCommand = type({
  commandId: NonEmptyString,
  decision: '"allow_once" | "reject_once"',
  kind: '"permission.resolve"',
  requestId: NonEmptyString,
  runId: NonEmptyString,
});
export type PermissionResolveCommand = typeof PermissionResolveCommand.infer;

export const RuntimeCommand = TurnCancelCommand.or(InputStartCommand)
  .or(McpExecuteCommand)
  .or(SessionStopCommand)
  .or(PermissionResolveCommand);
export type RuntimeCommand = typeof RuntimeCommand.infer;

export const InputStartCommandResult = type({
  requestId: NonEmptyString,
});
export type InputStartCommandResult = typeof InputStartCommandResult.infer;

export const McpExecuteCommandResult = type({
  "isError?": "boolean",
  outputText: "string",
  requestId: NonEmptyString,
  serverId: NonEmptyString,
  toolName: NonEmptyString,
});
export type McpExecuteCommandResult = typeof McpExecuteCommandResult.infer;

export const RuntimeCommandResult = type("null")
  .or(InputStartCommandResult)
  .or(McpExecuteCommandResult);
export type RuntimeCommandResult = typeof RuntimeCommandResult.infer;
