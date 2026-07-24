import type {
  DriverCommandUpdateInput,
  DriverCompletionInput,
  DriverEventBatchInput,
  DriverEventBatchOutput,
  DriverFailureInput,
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverHelloOutput,
  DriverLogBatchInput,
  DriverLogBatchOutput,
  DriverNextCommandInput,
  DriverNextCommandOutput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";

import type { RuntimeOrpcContext } from "./rpc-wire";

export type DriverInstanceRpcContext = RuntimeOrpcContext;

export interface DriverInstanceRpcOperationContext {
  readonly connectionId: string;
  assertActiveConnection(): void;
}

export interface DriverInstanceRpcHandler {
  handleCommandUpdate(
    input: DriverCommandUpdateInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }>;
  handleCompleteRun(
    input: DriverCompletionInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }>;
  handleFailRun(
    input: DriverFailureInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }>;
  handleHeartbeat(
    input: DriverHeartbeatInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ heartbeatCount: number; ok: true }>;
  handleHello(
    input: DriverHelloInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverHelloOutput>;
  handleNextCommand(
    input: DriverNextCommandInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverNextCommandOutput>;
  handlePushEvents(
    input: DriverEventBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverEventBatchOutput>;
  handlePushLogs(
    input: DriverLogBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverLogBatchOutput>;
  handleReady(
    input: DriverReadyInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }>;
  watchCommands(context: DriverInstanceRpcOperationContext): AsyncIterable<RuntimeCommand>;
}

export function createDriverInstanceRpcContext(
  handler: DriverInstanceRpcHandler,
  context: DriverInstanceRpcOperationContext,
): DriverInstanceRpcContext {
  return {
    onCommandUpdate: async (input) => handler.handleCommandUpdate(input, context),
    onCompleteRun: async (input) => handler.handleCompleteRun(input, context),
    onFailRun: async (input) => handler.handleFailRun(input, context),
    onHeartbeat: async (input) => handler.handleHeartbeat(input, context),
    onHello: async (input) => handler.handleHello(input, context),
    onNextCommand: async (input) => handler.handleNextCommand(input, context),
    onPushEvents: async (input) => handler.handlePushEvents(input, context),
    onPushLogs: async (input) => handler.handlePushLogs(input, context),
    onReady: async (input) => handler.handleReady(input, context),
    onWatchCommands: () =>
      handler.watchCommands(context)[Symbol.asyncIterator]() as ReturnType<
        RuntimeOrpcContext["onWatchCommands"]
      >,
  };
}
