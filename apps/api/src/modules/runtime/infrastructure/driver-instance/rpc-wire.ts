import { DriverCapability } from "@mosoo/contracts/driver-instance";
import {
  RuntimeCommand,
  RuntimeCommandResult,
  RuntimeCommandStatus,
} from "@mosoo/contracts/runtime-command";
import { RunError } from "@mosoo/contracts/session-run";
import { NonEmptyString, PrimitiveRecord, parseSchemaValue } from "@mosoo/contracts/validation";
import { eventIterator, os } from "@orpc/server";
import { parseDriverEventEnvelope } from "agent-driver/events";
import type {
  DriverCommandUpdateInput,
  DriverCompletionInput,
  DriverEventBatchInput,
  DriverEventBatchOutput,
  DriverFailureInput,
  DriverHeartbeatInput,
  DriverHeartbeatOutput,
  DriverHelloInput,
  DriverHelloOutput,
  DriverLogBatchInput,
  DriverLogBatchOutput,
  DriverNextCommandInput,
  DriverNextCommandOutput,
  DriverReadyInput,
} from "agent-driver/orpc";
import { type } from "arktype";

const DriverHelloInputWire = type({
  capabilities: DriverCapability.array(),
  driverVersion: NonEmptyString,
  pid: "number",
  protocolVersion: "1",
  runtime: '"openai-runtime" | "claude-agent-sdk" | "acp-fallback"',
  startedAt: "string",
});

const DriverHelloOutputWire = type({
  acceptedCapabilities: DriverCapability.array(),
  connectionId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  heartbeatIntervalMs: "number >= 250",
  runConfig: {
    commandLeaseMs: "number >= 0",
    envPolicy: '"strict"',
    eventBatchMaxSize: "number >= 0",
    organizationPath: NonEmptyString,
  },
  runId: "string | null",
});

const DriverHeartbeatInputWire = type({
  at: "string",
  pid: "number",
  reason: '"interval" | "ping"',
});

const DriverHeartbeatOutputWire = type({
  heartbeatCount: "number >= 0",
  ok: "true",
});

const DriverReadyInputWire = type({
  at: NonEmptyString,
  driverInstanceId: NonEmptyString,
  pid: "number",
});

const DriverEventEnvelopeWire = type({
  event: "unknown",
  eventId: NonEmptyString,
  "occurredAt?": "number | null | undefined",
});

const DriverEventReceiptWire = type({
  "eventId?": "string | undefined",
  seq: "number >= 0",
  type: NonEmptyString,
});

const DriverEventBatchInputWire = type({
  driverInstanceId: NonEmptyString,
  events: DriverEventEnvelopeWire.array(),
});

const DriverEventBatchOutputWire = type({
  accepted: DriverEventReceiptWire.array(),
});

const DriverLogContextWire = type({
  "parentSpanId?": "string",
  "requestId?": "string",
  "sandboxId?": "string",
  "sessionId?": "string",
  "spanId?": NonEmptyString,
  "traceId?": NonEmptyString,
});

const DriverLogErrorWire = type({
  "code?": "string | number",
  message: NonEmptyString,
  name: NonEmptyString,
  "stack?": "string | null",
});

const DriverLogEntryWire = type({
  "context?": DriverLogContextWire,
  "error?": DriverLogErrorWire,
  "fields?": PrimitiveRecord,
  level: '"debug" | "error" | "info" | "trace" | "warn"',
  message: NonEmptyString,
  "namespace?": "string | null",
  seq: "number >= 0",
  timestamp: NonEmptyString,
});

const DriverLogBatchInputWire = type({
  driverInstanceId: NonEmptyString,
  logs: DriverLogEntryWire.array(),
});

const DriverLogBatchOutputWire = type({
  ok: "true",
});

const DriverCommandUpdateInputWire = type({
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  "error?": RunError,
  "result?": RuntimeCommandResult,
  status: RuntimeCommandStatus,
});

const DriverNextCommandInputWire = type({
  driverInstanceId: NonEmptyString,
});

const DriverNextCommandOutputWire = type({
  command: type("null").or(RuntimeCommand),
});

const DriverCompletionInputWire = type({
  driverInstanceId: NonEmptyString,
});

const DriverFailureInputWire = type({
  driverInstanceId: NonEmptyString,
  error: RunError,
});

type DriverEventBatchOutputWireValue = typeof DriverEventBatchOutputWire.infer;
type DriverHelloOutputWireValue = typeof DriverHelloOutputWire.infer;
type DriverNextCommandOutputWireValue = typeof DriverNextCommandOutputWire.infer;

export interface RuntimeOrpcContext {
  onCommandUpdate(input: DriverCommandUpdateInput): Promise<{ ok: true }>;
  onCompleteRun(input: DriverCompletionInput): Promise<{ ok: true }>;
  onFailRun(input: DriverFailureInput): Promise<{ ok: true }>;
  onHeartbeat(input: DriverHeartbeatInput): Promise<DriverHeartbeatOutput>;
  onHello(input: DriverHelloInput): Promise<DriverHelloOutput>;
  onNextCommand(input: DriverNextCommandInput): Promise<DriverNextCommandOutput>;
  onPushEvents(input: DriverEventBatchInput): Promise<DriverEventBatchOutput>;
  onPushLogs(input: DriverLogBatchInput): Promise<DriverLogBatchOutput>;
  onReady(input: DriverReadyInput): Promise<{ ok: true }>;
  onWatchCommands(): AsyncIteratorObject<RuntimeCommand>;
}

export function parseDriverCommandUpdateInput(input: unknown): DriverCommandUpdateInput {
  return parseSchemaValue(DriverCommandUpdateInputWire, input);
}

export function parseDriverCompletionInput(input: unknown): DriverCompletionInput {
  return parseSchemaValue(DriverCompletionInputWire, input);
}

export function parseDriverEventBatchInput(input: unknown): DriverEventBatchInput {
  const batch = parseSchemaValue(DriverEventBatchInputWire, input);

  return {
    driverInstanceId: batch.driverInstanceId,
    events: batch.events.map(parseDriverEventEnvelope),
  };
}

export function parseDriverFailureInput(input: unknown): DriverFailureInput {
  return parseSchemaValue(DriverFailureInputWire, input);
}

export function parseDriverLogBatchInput(input: unknown): DriverLogBatchInput {
  return parseSchemaValue(DriverLogBatchInputWire, input);
}

export function parseDriverNextCommandInput(input: unknown): DriverNextCommandInput {
  return parseSchemaValue(DriverNextCommandInputWire, input);
}

export function parseDriverReadyInput(input: unknown): DriverReadyInput {
  return parseSchemaValue(DriverReadyInputWire, input);
}

function toDriverEventBatchOutputWire(
  output: DriverEventBatchOutput,
): DriverEventBatchOutputWireValue {
  return parseSchemaValue(DriverEventBatchOutputWire, output);
}

function toDriverHelloOutputWire(output: DriverHelloOutput): DriverHelloOutputWireValue {
  return parseSchemaValue(DriverHelloOutputWire, output);
}

function toDriverNextCommandOutputWire(
  output: DriverNextCommandOutput,
): DriverNextCommandOutputWireValue {
  return parseSchemaValue(DriverNextCommandOutputWire, output);
}

const base = os.$context<RuntimeOrpcContext>();

export const runtimeOrpcRouter = {
  driver: {
    commandUpdate: base
      .input(DriverCommandUpdateInputWire)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) =>
        context.onCommandUpdate(parseDriverCommandUpdateInput(input)),
      ),
    completeRun: base
      .input(DriverCompletionInputWire)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) =>
        context.onCompleteRun(parseDriverCompletionInput(input)),
      ),
    failRun: base
      .input(DriverFailureInputWire)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) => context.onFailRun(parseDriverFailureInput(input))),
    heartbeat: base
      .input(DriverHeartbeatInputWire)
      .output(DriverHeartbeatOutputWire)
      .handler(async ({ context, input }) => context.onHeartbeat(input)),
    hello: base
      .input(DriverHelloInputWire)
      .output(DriverHelloOutputWire)
      .handler(async ({ context, input }) => toDriverHelloOutputWire(await context.onHello(input))),
    pushEvents: base
      .input(DriverEventBatchInputWire)
      .output(DriverEventBatchOutputWire)
      .handler(async ({ context, input }) =>
        toDriverEventBatchOutputWire(await context.onPushEvents(parseDriverEventBatchInput(input))),
      ),
    pushLogs: base
      .input(DriverLogBatchInputWire)
      .output(DriverLogBatchOutputWire)
      .handler(async ({ context, input }) => context.onPushLogs(parseDriverLogBatchInput(input))),
    ready: base
      .input(DriverReadyInputWire)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) => context.onReady(parseDriverReadyInput(input))),
  },
  driverInstance: {
    nextCommand: base
      .input(DriverNextCommandInputWire)
      .output(DriverNextCommandOutputWire)
      .handler(async ({ context, input }) =>
        toDriverNextCommandOutputWire(
          await context.onNextCommand(parseDriverNextCommandInput(input)),
        ),
      ),
    watchCommands: base
      .output(eventIterator(RuntimeCommand))
      .handler(({ context }) => context.onWatchCommands()),
  },
};

export type DriverRuntimeOrpcRouter = typeof runtimeOrpcRouter;
