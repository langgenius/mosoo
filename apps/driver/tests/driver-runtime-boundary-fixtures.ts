import type { RuntimeCommand } from "@mosoo/contracts";
import type { DriverOrganizationAccessSnapshotOutput } from "@mosoo/driver-protocol";
import { createBufferedSinkLogger } from "@mosoo/observability";

import { DriverCommandDispatcher } from "../src/core/driver-command-dispatcher";
import { DriverPermissionBroker } from "../src/core/driver-permission-broker";
import type { DriverRuntimeStateMachine } from "../src/core/driver-runtime-state";
import { DriverInstanceSocket } from "../src/infrastructure/runtime/driver-instance-socket";
import type { AgentDriverBackend, AgentDriverContext } from "../src/runtimes/agent-driver-backend";
import {
  DRIVER_TEST_IDS,
  driverBootPayload,
  driverTestAccessSnapshot,
} from "./driver-boot-payload-fixture";

export { DRIVER_TEST_IDS };

export const bootPayload = driverBootPayload;
export const accessSnapshot = driverTestAccessSnapshot;

async function* commandStream(commands: readonly RuntimeCommand[]): AsyncIterable<RuntimeCommand> {
  for (const command of commands) {
    yield command;
  }
}

export class FakeDriverInstanceSocket extends DriverInstanceSocket {
  readonly completedRunReasons: string[] = [];
  readonly failedRuns: Parameters<DriverInstanceSocket["failRun"]>[0][] = [];
  readonly updates: Parameters<DriverInstanceSocket["commandUpdate"]>[0][] = [];
  readonly #commands: readonly RuntimeCommand[];
  #commandIndex = 0;

  constructor(commands: readonly RuntimeCommand[]) {
    super(bootPayload, { onClose: () => {} });
    this.#commands = commands;
  }

  override async watchCommands(): Promise<AsyncIterable<RuntimeCommand>> {
    return commandStream(this.#commands);
  }

  override async nextCommand(): Promise<RuntimeCommand | null> {
    const command = this.#commands[this.#commandIndex] ?? null;

    if (command !== null) {
      this.#commandIndex += 1;
    }

    return command;
  }

  isDrained(): boolean {
    return this.#commandIndex >= this.#commands.length;
  }

  override async commandUpdate(
    input: Parameters<DriverInstanceSocket["commandUpdate"]>[0],
  ): Promise<void> {
    this.updates.push(input);
  }

  override async completeRun(): Promise<void> {
    this.completedRunReasons.push("completed");
  }

  override async failRun(error: Parameters<DriverInstanceSocket["failRun"]>[0]): Promise<void> {
    this.failedRuns.push(error);
  }
}

export interface RecordingBackend extends AgentDriverBackend {
  readonly cancelledReasons: string[];
  readonly handledInputs: AgentDriverContext["payload"]["execution"]["session"][];
  readonly refreshedSnapshots: DriverOrganizationAccessSnapshotOutput[];
  failInput: boolean;
}

export function createBackend(): RecordingBackend {
  return {
    cancelledReasons: [],
    failInput: false,
    handledInputs: [],
    refreshedSnapshots: [],
    runtime: "openai-runtime",
    async cancelActiveTurn(_context, reason) {
      this.cancelledReasons.push(reason);
    },
    async handleInput(context) {
      if (this.failInput) {
        throw new Error("backend rejected input");
      }

      this.handledInputs.push(context.payload.execution.session);
    },
    async handleMcpExecute(_context, command) {
      return {
        outputText: `ran ${command.toolName}`,
        requestId: command.requestId,
        serverId: command.serverId,
        toolName: command.toolName,
      };
    },
    async refreshOrganizationAccess(_context, snapshot) {
      this.refreshedSnapshots.push(snapshot);
    },
    async start() {},
    async stop() {},
  };
}

export function createDispatcher(input: {
  backend: AgentDriverBackend;
  isShuttingDown?: () => boolean;
  runtimeState: DriverRuntimeStateMachine;
  shutdown?: (socket: DriverInstanceSocket, reason: string) => Promise<void>;
}) {
  const logger = createBufferedSinkLogger({
    level: "debug",
    service: "driver-runtime-boundary-test",
    sink: async () => {},
  });
  const permissions = new DriverPermissionBroker(() => logger);
  const shutdownCalls: string[] = [];
  const dispatcher = new DriverCommandDispatcher({
    backend: input.backend,
    driverInstanceId: DRIVER_TEST_IDS.driverInstanceId,
    isShuttingDown: input.isShuttingDown ?? (() => false),
    permissionRequests: permissions,
    runtimeContextFactory: (socket, runtimeLogger) => ({
      logger: runtimeLogger,
      payload: bootPayload,
      permissions: {
        request: async () => "reject_once",
      },
      socket,
    }),
    runtimeState: input.runtimeState,
    sandboxId: DRIVER_TEST_IDS.sandboxId,
    shutdown:
      input.shutdown ??
      (async (_socket, reason) => {
        shutdownCalls.push(reason);
      }),
  });

  return {
    dispatcher,
    logger,
    shutdownCalls,
  };
}

export async function waitForUpdate(
  socket: FakeDriverInstanceSocket,
  predicate: (update: Parameters<DriverInstanceSocket["commandUpdate"]>[0]) => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (socket.updates.some(predicate)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("Timed out waiting for command update.");
}
