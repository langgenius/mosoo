import type { McpExecuteCommand, RuntimeCommandInput } from "@mosoo/contracts";
import type {
  DriverBootPayload,
  DriverOrganizationAccessSnapshotOutput,
  DriverRuntime,
} from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";
import type { Logger } from "@mosoo/observability";

import type { DriverInstanceSocket } from "../infrastructure/runtime/driver-instance-socket";

export interface AgentDriverContext {
  logger: Logger;
  payload: DriverBootPayload;
  permissions: {
    request(input: {
      rawInput: string | null;
      requestId: string;
      title: string;
      toolCallId: string | null;
      toolKind: string | null;
    }): Promise<"allow_once" | "reject_once">;
  };
  socket: DriverInstanceSocket;
}

export interface AgentDriverBackend {
  readonly runtime: DriverRuntime;
  cancelActiveTurn(context: AgentDriverContext, reason: string): Promise<void>;
  handleInput(
    context: AgentDriverContext,
    input: RuntimeCommandInput,
    runId: SessionRunId,
  ): Promise<void>;
  handleMcpExecute(
    context: AgentDriverContext,
    command: McpExecuteCommand,
  ): Promise<{ outputText: string; requestId: string; serverId: string; toolName: string }>;
  refreshOrganizationAccess(
    context: AgentDriverContext,
    snapshot: DriverOrganizationAccessSnapshotOutput,
  ): Promise<void>;
  start(context: AgentDriverContext): Promise<void>;
  stop(context: AgentDriverContext, reason: string): Promise<void>;
}

export type AgentDriverBackendFactory = (
  payload: DriverBootPayload,
) => AgentDriverBackend | Promise<AgentDriverBackend>;
