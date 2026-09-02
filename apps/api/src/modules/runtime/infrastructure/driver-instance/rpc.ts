import type {
  DriverCommandUpdateInput,
  DriverCompletionInput,
  DriverEventBatchOutput,
  DriverExternalToolEffectClaimInput,
  DriverExternalToolEffectClaimOutput,
  DriverExternalToolEffectObserveInput,
  DriverExternalToolEffectSettleInput,
  DriverExternalToolEffectState,
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

import type { HostDriverEventBatchInput } from "./event-types";
import type { RuntimeOrpcContext } from "./rpc-wire";
import type { DriverInstanceConnectionEpoch } from "./state";

export type DriverInstanceRpcContext = RuntimeOrpcContext;

export interface DriverInstanceRpcOperationContext {
  readonly connectionId: string;
  readonly epoch: DriverInstanceConnectionEpoch;
  assertActiveConnection(): void;
}

export interface DriverInstanceRpcHandler {
  handleCommandUpdate(
    input: DriverCommandUpdateInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<{ ok: true }>;
  handleClaimExternalToolEffect(
    input: DriverExternalToolEffectClaimInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectClaimOutput>;
  handleObserveExternalToolEffect(
    input: DriverExternalToolEffectObserveInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectState>;
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
    input: HostDriverEventBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverEventBatchOutput>;
  handlePushLogs(
    input: DriverLogBatchInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverLogBatchOutput>;
  handleSettleExternalToolEffect(
    input: DriverExternalToolEffectSettleInput,
    context: DriverInstanceRpcOperationContext,
  ): Promise<DriverExternalToolEffectState>;
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
    onClaimExternalToolEffect: async (input) =>
      handler.handleClaimExternalToolEffect(input, context),
    onCommandUpdate: async (input) => handler.handleCommandUpdate(input, context),
    onCompleteRun: async (input) => handler.handleCompleteRun(input, context),
    onFailRun: async (input) => handler.handleFailRun(input, context),
    onHeartbeat: async (input) => handler.handleHeartbeat(input, context),
    onHello: async (input) => handler.handleHello(input, context),
    onNextCommand: async (input) => handler.handleNextCommand(input, context),
    onObserveExternalToolEffect: async (input) =>
      handler.handleObserveExternalToolEffect(input, context),
    onPushEvents: async (input) => handler.handlePushEvents(input, context),
    onPushLogs: async (input) => handler.handlePushLogs(input, context),
    onReady: async (input) => handler.handleReady(input, context),
    onSettleExternalToolEffect: async (input) =>
      handler.handleSettleExternalToolEffect(input, context),
    onWatchCommands: () =>
      handler.watchCommands(context)[Symbol.asyncIterator]() as ReturnType<
        RuntimeOrpcContext["onWatchCommands"]
      >,
  };
}
