import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";

import { createDeferred } from "./driver-instance-support";
import type { Deferred } from "./driver-instance-support";

export const COMMAND_LEASE_MS = 15_000;

export interface DriverInstanceCommandState {
  commandQueue: RuntimeCommand[];
  commandWaiters: RuntimeCommandWaiter[];
  terminalized: boolean;
}

interface CommandOptions {
  markCommandDelivered: (command: RuntimeCommand) => Promise<boolean>;
  persistCommandQueue: () => Promise<void>;
}

export interface RuntimeCommandWaiter extends CommandOptions {
  assertActiveConnection: () => void;
  connectionId: string;
  deferred: Deferred<RuntimeCommand | null>;
}

async function dispatchQueuedRuntimeCommands(
  state: DriverInstanceCommandState,
  options: Pick<CommandOptions, "persistCommandQueue">,
): Promise<void> {
  while (state.commandQueue.length > 0 && state.commandWaiters.length > 0) {
    const waiter = state.commandWaiters.shift();
    const command = state.commandQueue.shift();

    if (!waiter || !command) {
      return;
    }

    try {
      waiter.assertActiveConnection();
      await options.persistCommandQueue();
      const delivered = await waiter.markCommandDelivered(command);
      waiter.assertActiveConnection();

      if (!delivered) {
        state.commandQueue.unshift(command);
        await options.persistCommandQueue();
        waiter.deferred.resolve(null);
        continue;
      }

      waiter.deferred.resolve(command);
    } catch {
      state.commandQueue.unshift(command);
      await options.persistCommandQueue();
      waiter.deferred.resolve(null);
    }
  }
}

export async function enqueueRuntimeCommand(
  state: DriverInstanceCommandState,
  command: RuntimeCommand,
  options: Pick<CommandOptions, "persistCommandQueue"> & {
    onClosed: () => Error;
  },
): Promise<void> {
  if (state.terminalized) {
    throw options.onClosed();
  }

  state.commandQueue.push(command);
  await options.persistCommandQueue();
  await dispatchQueuedRuntimeCommands(state, options);
}

export async function nextRuntimeCommand(
  state: DriverInstanceCommandState,
  options: CommandOptions & {
    assertActiveConnection: () => void;
    connectionId: string;
  },
): Promise<RuntimeCommand | null> {
  if (state.commandQueue.length > 0) {
    const command = state.commandQueue.shift() ?? null;

    await options.persistCommandQueue();

    if (!command) {
      return null;
    }

    options.assertActiveConnection();
    const delivered = await options.markCommandDelivered(command);
    options.assertActiveConnection();

    if (!delivered) {
      state.commandQueue.unshift(command);
      await options.persistCommandQueue();
      return null;
    }

    return command;
  }

  if (state.terminalized) {
    return null;
  }

  const deferred = createDeferred<RuntimeCommand | null>();
  state.commandWaiters.push({
    assertActiveConnection: options.assertActiveConnection,
    connectionId: options.connectionId,
    deferred,
    markCommandDelivered: options.markCommandDelivered,
    persistCommandQueue: options.persistCommandQueue,
  });
  return deferred.promise;
}

export async function removeRuntimeCommandFromQueue(
  state: DriverInstanceCommandState,
  commandId: string,
  options: Pick<CommandOptions, "persistCommandQueue">,
): Promise<void> {
  const index = state.commandQueue.findIndex((command) => command.commandId === commandId);

  if (index === -1) {
    return;
  }

  state.commandQueue.splice(index, 1);
  await options.persistCommandQueue();
}

export function resolvePendingRuntimeCommands(commandWaiters: RuntimeCommandWaiter[]): void {
  for (const waiter of commandWaiters.splice(0)) {
    waiter.deferred.resolve(null);
  }
}

export async function* watchRuntimeCommands(
  state: DriverInstanceCommandState,
  loadNextCommand: () => Promise<RuntimeCommand | null>,
): AsyncIterable<RuntimeCommand> {
  if (state.terminalized) {
    return;
  }

  const command = await loadNextCommand();

  if (!command) {
    return;
  }

  yield command;
  yield* watchRuntimeCommands(state, loadNextCommand);
}
