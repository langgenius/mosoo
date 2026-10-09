import type { DriverInstanceId } from "@mosoo/id";

import type { DriverInstanceRpcCommandController } from "./rpc-command-controller";
import type { DriverInstanceRpcEventIngestionController } from "./rpc-event-ingestion-controller";
import type { DriverInstanceRpcHandshakeController } from "./rpc-handshake-controller";
import type { DriverInstanceRpcRunTerminalController } from "./rpc-run-terminal-controller";
import type { RuntimeOrpcContext } from "./rpc-wire";

export interface DriverInstanceRpcOperationContext {
  readonly connectionId: string;
  readonly driverInstanceId: DriverInstanceId;
  assertActiveConnection(): void;
}

export interface DriverInstanceRpcControllers {
  readonly commands: DriverInstanceRpcCommandController;
  readonly events: DriverInstanceRpcEventIngestionController;
  readonly handshake: DriverInstanceRpcHandshakeController;
  readonly terminal: DriverInstanceRpcRunTerminalController;
}

export function createDriverInstanceRpcContext(
  { commands, events, handshake, terminal }: DriverInstanceRpcControllers,
  context: DriverInstanceRpcOperationContext,
): RuntimeOrpcContext {
  function forThisDriver<I extends { readonly driverInstanceId: string }, O>(
    handle: (input: I) => Promise<O>,
  ): (input: I) => Promise<O> {
    return async (input) => {
      if (input.driverInstanceId !== context.driverInstanceId) {
        throw new Error("Driver instance id mismatch.");
      }

      return handle(input);
    };
  }

  return {
    onCommandUpdate: forThisDriver(async (input) => commands.handleCommandUpdate(input, context)),
    onCompleteRun: forThisDriver(async () =>
      events.runAfterPendingEvents(async () => terminal.handleCompleteRun(context)),
    ),
    onFailRun: forThisDriver(async (input) =>
      events.runAfterPendingEvents(async () => terminal.handleFailRun(input, context)),
    ),
    onHeartbeat: async (input) => handshake.handleHeartbeat(input, context),
    onHello: async (input) => handshake.handleHello(input, context),
    onNextCommand: forThisDriver(async () => commands.handleNextCommand(context)),
    onPushEvents: forThisDriver(async (input) => events.handlePushEvents(input, context)),
    onPushLogs: forThisDriver(async (input) => events.handlePushLogs(input, context)),
    onReady: forThisDriver(async (input) => handshake.handleReady(input, context)),
  };
}
