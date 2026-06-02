import { randomUUID } from "node:crypto";

import type { RunError, RuntimeCommand, RuntimeCommandResult } from "@mosoo/contracts";
import type {
  DriverBootPayload,
  DriverEventEnvelope,
  DriverEventInput,
  DriverFailureInput,
  DriverHeartbeatInput,
  DriverHeartbeatOutput,
  DriverHelloInput,
  DriverLogBatchInput,
  DriverRuntimeOrpcRouter,
  DriverReadyInput,
} from "@mosoo/driver-protocol";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { SessionRunId } from "@mosoo/id";
import { isRuntimeEventEnvelope, toRuntimeEventInput } from "@mosoo/runtime-events";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { RouterClient } from "@orpc/server";

import { acceptDriverControlSocket } from "./driver-local-control-server";
import type { DriverWireSocket } from "./driver-local-control-server";

interface DriverInstanceSocketHandlers {
  onClose: (code: number, reason: string) => void;
}

export class DriverInstanceSocket {
  #activeRunId: SessionRunId | null = null;
  #client: RouterClient<DriverRuntimeOrpcRouter> | null = null;
  private readonly handlers: DriverInstanceSocketHandlers;
  private readonly payload: DriverBootPayload;
  #socket: DriverWireSocket | null = null;

  constructor(payload: DriverBootPayload, handlers: DriverInstanceSocketHandlers) {
    this.handlers = handlers;
    this.payload = payload;
  }

  async connect(): Promise<void> {
    const socket = await acceptDriverControlSocket(this.payload);
    this.#socket = socket;

    socket.addEventListener("close", (event) => {
      if (event instanceof CloseEvent) {
        this.handlers.onClose(event.code, event.reason);
        return;
      }

      this.handlers.onClose(1006, "runtime.socket.closed");
    });

    this.#client = createORPCClient<RouterClient<DriverRuntimeOrpcRouter>>(
      new RPCLink({
        websocket: socket,
      }),
    );
  }

  close(code = 1000, reason = "runtime.socket.closed"): void {
    this.#socket?.close(code, reason);
    this.#socket = null;
  }

  beginRun(runId: SessionRunId): void {
    this.#activeRunId = runId;
  }

  endRun(runId: SessionRunId): void {
    if (this.#activeRunId === runId) {
      this.#activeRunId = null;
    }
  }

  async commandUpdate(input: {
    commandId: string;
    error?: RunError;
    result?: RuntimeCommandResult;
    status: "accepted" | "cancelled" | "completed" | "delivered" | "expired" | "failed";
  }): Promise<void> {
    await this.#requireClient().driver.commandUpdate({
      commandId: input.commandId,
      driverInstanceId: this.payload.driverInstanceId,
      ...(input.error === undefined ? {} : { error: input.error }),
      status: input.status,
      ...(input.result === undefined ? {} : { result: input.result }),
    });
  }

  async completeRun(): Promise<void> {
    await this.#requireClient().driver.completeRun({
      driverInstanceId: this.payload.driverInstanceId,
    });
  }

  async failRun(error: DriverFailureInput["error"]): Promise<void> {
    await this.#requireClient().driver.failRun({
      driverInstanceId: this.payload.driverInstanceId,
      error,
    });
  }

  async heartbeat(input: Omit<DriverHeartbeatInput, "pid">): Promise<DriverHeartbeatOutput> {
    return this.#requireClient().driver.heartbeat({
      at: input.at,
      pid: process.pid,
      reason: input.reason,
    });
  }

  async hello(
    input: Omit<DriverHelloInput, "pid" | "runtime" | "startedAt"> & {
      startedAt: string;
    },
  ) {
    return this.#requireClient().driver.hello({
      capabilities: input.capabilities,
      driverVersion: input.driverVersion,
      pid: process.pid,
      protocolVersion: input.protocolVersion,
      runtime: this.payload.runtime,
      startedAt: input.startedAt,
    });
  }

  async pushEvents(input: { events: DriverEventInput[] }): Promise<void> {
    await this.#requireClient().driver.pushEvents({
      driverInstanceId: this.payload.driverInstanceId,
      events: input.events.flatMap((event) =>
        toDriverEventEnvelopes(this.payload, event, this.#activeRunId),
      ),
    });
  }

  async pushLogs(input: Omit<DriverLogBatchInput, "driverInstanceId">): Promise<void> {
    await this.#requireClient().driver.pushLogs({
      driverInstanceId: this.payload.driverInstanceId,
      logs: input.logs,
    });
  }

  async ready(input: Omit<DriverReadyInput, "driverInstanceId" | "pid">): Promise<void> {
    await this.#requireClient().driver.ready({
      at: input.at,
      driverInstanceId: this.payload.driverInstanceId,
      pid: process.pid,
    });
  }

  async watchCommands(): Promise<AsyncIterable<RuntimeCommand>> {
    return this.#requireClient().driverInstance.watchCommands();
  }

  async nextCommand(): Promise<RuntimeCommand | null> {
    const result = await this.#requireClient().driverInstance.nextCommand({
      driverInstanceId: this.payload.driverInstanceId,
    });

    return result.command;
  }

  #requireClient(): RouterClient<DriverRuntimeOrpcRouter> {
    if (!this.#client) {
      throw new Error("Driver instance socket is not connected.");
    }

    return this.#client;
  }
}

function readEventOccurredAt(event: DriverEventInput): number {
  const occurredAt = isRuntimeEventEnvelope(event) ? event.occurredAt : event.occurredAt;
  const timestamp = occurredAt === undefined ? Date.now() : Date.parse(occurredAt);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function readSourceEventId(event: DriverEventInput): string {
  if (isRuntimeEventEnvelope(event)) {
    return event.sourceEventId ?? event.id;
  }

  return event.sourceEventId ?? randomUUID();
}

function parseSessionRunId(value: string): SessionRunId {
  return parsePlatformId(value, "Session run ID") as SessionRunId;
}

function readEventRunId(
  event: DriverEventInput,
  activeRunId: SessionRunId | null,
): SessionRunId | undefined {
  if (activeRunId !== null) {
    return activeRunId;
  }

  const eventRunId = isRuntimeEventEnvelope(event) ? event.runId : event.runId;

  return eventRunId === undefined ? undefined : parseSessionRunId(eventRunId);
}

export function toDriverEventEnvelopes(
  payload: DriverBootPayload,
  event: DriverEventInput,
  activeRunId: SessionRunId | null,
): DriverEventEnvelope[] {
  const occurredAtMs = readEventOccurredAt(event);
  const sourceEventId = readSourceEventId(event);
  const occurredAt = new Date(occurredAtMs).toISOString();
  const runId = readEventRunId(event, activeRunId);

  return toRuntimeEventInput(
    {
      createId: createPlatformId,
      draftRunIdPolicy: "ignore",
      driverInstanceId: parsePlatformId(payload.driverInstanceId, "Driver instance ID"),
      occurredAt,
      runId,
      runtimeId: payload.runtime,
      sessionId: parsePlatformId(payload.execution.configRevision.sessionId, "Session ID"),
      sourceEventId,
    },
    event,
  ).map(
    (canonicalEvent): DriverEventEnvelope => ({
      event: canonicalEvent,
      eventId: canonicalEvent.sourceEventId ?? canonicalEvent.id,
      occurredAt: Date.parse(canonicalEvent.occurredAt),
    }),
  );
}
