import { DriverCapability } from "@mosoo/contracts/driver-instance";
import {
  RuntimeCommand,
  RuntimeCommandResult,
  RuntimeCommandStatus,
} from "@mosoo/contracts/runtime-command";
import { RunError } from "@mosoo/contracts/session-run";
import { NonEmptyString, PrimitiveRecord, parseSchemaValue } from "@mosoo/contracts/validation";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SpaceId } from "@mosoo/id";
import { eventIterator, os } from "@orpc/server";
import { type } from "arktype";

import {
  DriverEventEnvelope as DriverEventEnvelopeSchema,
  parseDriverEventEnvelope,
} from "./runtime-driver-event-schema";
import type { DriverEventEnvelope as RuntimeDriverEventEnvelope } from "./runtime-driver-event-schema";

export { DriverEventEnvelope, parseDriverEventEnvelope } from "./runtime-driver-event-schema";
export type { DriverEvent, DriverEventInput } from "./runtime-driver-event-schema";

export const DriverHelloInput = type({
  capabilities: DriverCapability.array(),
  driverVersion: NonEmptyString,
  pid: "number",
  protocolVersion: "1",
  runtime: '"openai-runtime" | "claude-agent-sdk" | "acp-fallback"',
  startedAt: "string",
});
export type DriverHelloInput = typeof DriverHelloInput.infer;

export const DriverHelloOutput = type({
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
  sessionRunId: "string | null",
});
type DriverHelloOutputInput = typeof DriverHelloOutput.infer;
export interface DriverHelloOutput extends Omit<DriverHelloOutputInput, "driverInstanceId"> {
  driverInstanceId: DriverInstanceId;
}

export const DriverHeartbeatInput = type({
  at: "string",
  pid: "number",
  reason: '"interval" | "ping"',
});
export type DriverHeartbeatInput = typeof DriverHeartbeatInput.infer;

export const DriverHeartbeatOutput = type({
  heartbeatCount: "number >= 0",
  ok: "true",
});
export type DriverHeartbeatOutput = typeof DriverHeartbeatOutput.infer;

export const DriverReadyInput = type({
  at: NonEmptyString,
  driverInstanceId: NonEmptyString,
  pid: "number",
});
type DriverReadyInputInput = typeof DriverReadyInput.infer;
export interface DriverReadyInput extends Omit<DriverReadyInputInput, "driverInstanceId"> {
  driverInstanceId: DriverInstanceId;
}

export const DriverEventReceipt = type({
  "eventId?": "string | undefined",
  seq: "number >= 0",
  type: NonEmptyString,
});
export type DriverEventReceipt = typeof DriverEventReceipt.infer;

export const DriverEventBatchInput = type({
  driverInstanceId: NonEmptyString,
  events: DriverEventEnvelopeSchema.array(),
});
export interface DriverEventBatchInput {
  driverInstanceId: DriverInstanceId;
  events: RuntimeDriverEventEnvelope[];
}

export const DriverEventBatchOutput = type({
  accepted: DriverEventReceipt.array(),
});
export interface DriverEventBatchOutput {
  accepted: DriverEventReceipt[];
}

export const DriverLogContext = type({
  "parentSpanId?": "string",
  "requestId?": "string",
  "sandboxId?": "string",
  "sessionId?": "string",
  "spanId?": NonEmptyString,
  "traceId?": NonEmptyString,
});
export type DriverLogContext = typeof DriverLogContext.infer;

export const DriverLogError = type({
  "code?": "string | number",
  message: NonEmptyString,
  name: NonEmptyString,
  "stack?": "string | null",
});
export type DriverLogError = typeof DriverLogError.infer;

export const DriverLogEntry = type({
  "context?": DriverLogContext,
  "error?": DriverLogError,
  "fields?": PrimitiveRecord,
  level: '"debug" | "error" | "info" | "trace" | "warn"',
  message: NonEmptyString,
  "namespace?": "string | null",
  seq: "number >= 0",
  timestamp: NonEmptyString,
});
export type DriverLogEntry = typeof DriverLogEntry.infer;

export const DriverLogBatchInput = type({
  driverInstanceId: NonEmptyString,
  logs: DriverLogEntry.array(),
});
type DriverLogBatchInputInput = typeof DriverLogBatchInput.infer;
export interface DriverLogBatchInput extends Omit<DriverLogBatchInputInput, "driverInstanceId"> {
  driverInstanceId: DriverInstanceId;
}

export const DriverLogBatchOutput = type({
  ok: "true",
});
export type DriverLogBatchOutput = typeof DriverLogBatchOutput.infer;

export const DriverOrganizationAccessSnapshotEntry = type({
  mountPath: NonEmptyString,
  role: '"admin" | "edit" | "read"',
  spaceId: NonEmptyString,
  type: '"space"',
});
export type DriverOrganizationAccessSnapshotEntry = Omit<
  typeof DriverOrganizationAccessSnapshotEntry.infer,
  "spaceId"
> & { spaceId: SpaceId };

export const DriverOrganizationAccessSnapshotOutput = type({
  entries: DriverOrganizationAccessSnapshotEntry.array(),
});
export type DriverOrganizationAccessSnapshotOutput =
  typeof DriverOrganizationAccessSnapshotOutput.infer;

export const DriverCommandUpdateInput = type({
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  "error?": RunError,
  "result?": RuntimeCommandResult,
  status: RuntimeCommandStatus,
});
type DriverCommandUpdateInputInput = typeof DriverCommandUpdateInput.infer;
export interface DriverCommandUpdateInput extends Omit<
  DriverCommandUpdateInputInput,
  "driverInstanceId"
> {
  driverInstanceId: DriverInstanceId;
}

export const DriverNextCommandInput = type({
  driverInstanceId: NonEmptyString,
});
type DriverNextCommandInputInput = typeof DriverNextCommandInput.infer;
export interface DriverNextCommandInput extends Omit<
  DriverNextCommandInputInput,
  "driverInstanceId"
> {
  driverInstanceId: DriverInstanceId;
}

export const DriverNextCommandOutput = type({
  command: type("null").or(RuntimeCommand),
});
export interface DriverNextCommandOutput {
  command: RuntimeCommand | null;
}

export const DriverCompletionInput = type({
  driverInstanceId: NonEmptyString,
});
type DriverCompletionInputInput = typeof DriverCompletionInput.infer;
export interface DriverCompletionInput extends Omit<
  DriverCompletionInputInput,
  "driverInstanceId"
> {
  driverInstanceId: DriverInstanceId;
}

export const DriverFailureInput = type({
  driverInstanceId: NonEmptyString,
  error: RunError,
});
type DriverFailureInputInput = typeof DriverFailureInput.infer;
export interface DriverFailureInput extends Omit<DriverFailureInputInput, "driverInstanceId"> {
  driverInstanceId: DriverInstanceId;
}

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

export function parseDriverEventBatchInput(input: unknown): DriverEventBatchInput {
  const batch = parseSchemaValue(DriverEventBatchInput, input);

  return {
    driverInstanceId: parsePlatformId(
      batch.driverInstanceId,
      "Driver instance ID",
    ) as DriverInstanceId,
    events: batch.events.map(parseDriverEventEnvelope),
  };
}

type DriverInstanceInput<TInput extends { readonly driverInstanceId: string }> = Omit<
  TInput,
  "driverInstanceId"
> & {
  driverInstanceId: DriverInstanceId;
};

function parseDriverInstanceId(value: unknown): DriverInstanceId {
  return parsePlatformId(value, "Driver instance ID") as DriverInstanceId;
}

function normalizeDriverInstanceInput<TInput extends { readonly driverInstanceId: string }>(
  input: TInput,
): DriverInstanceInput<TInput> {
  return {
    ...input,
    driverInstanceId: parseDriverInstanceId(input.driverInstanceId),
  };
}

export function parseDriverCommandUpdateInput(input: unknown): DriverCommandUpdateInput {
  return normalizeDriverInstanceInput(parseSchemaValue(DriverCommandUpdateInput, input));
}

export function parseDriverCompletionInput(input: unknown): DriverCompletionInput {
  return normalizeDriverInstanceInput(parseSchemaValue(DriverCompletionInput, input));
}

export function parseDriverFailureInput(input: unknown): DriverFailureInput {
  return normalizeDriverInstanceInput(parseSchemaValue(DriverFailureInput, input));
}

export function parseDriverLogBatchInput(input: unknown): DriverLogBatchInput {
  return normalizeDriverInstanceInput(parseSchemaValue(DriverLogBatchInput, input));
}

export function parseDriverNextCommandInput(input: unknown): DriverNextCommandInput {
  return normalizeDriverInstanceInput(parseSchemaValue(DriverNextCommandInput, input));
}

export function parseDriverReadyInput(input: unknown): DriverReadyInput {
  return normalizeDriverInstanceInput(parseSchemaValue(DriverReadyInput, input));
}

const base = os.$context<RuntimeOrpcContext>();

export const runtimeOrpcRouter = {
  driver: {
    commandUpdate: base
      .input(DriverCommandUpdateInput)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) =>
        context.onCommandUpdate(parseDriverCommandUpdateInput(input)),
      ),
    completeRun: base
      .input(DriverCompletionInput)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) =>
        context.onCompleteRun(parseDriverCompletionInput(input)),
      ),
    failRun: base
      .input(DriverFailureInput)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) => context.onFailRun(parseDriverFailureInput(input))),
    heartbeat: base
      .input(DriverHeartbeatInput)
      .output(DriverHeartbeatOutput)
      .handler(async ({ context, input }) => context.onHeartbeat(input)),
    hello: base
      .input(DriverHelloInput)
      .output(DriverHelloOutput)
      .handler(async ({ context, input }) => context.onHello(input)),
    pushEvents: base
      .input(DriverEventBatchInput)
      .output(DriverEventBatchOutput)
      .handler(async ({ context, input }) =>
        context.onPushEvents(parseDriverEventBatchInput(input)),
      ),
    pushLogs: base
      .input(DriverLogBatchInput)
      .output(DriverLogBatchOutput)
      .handler(async ({ context, input }) => context.onPushLogs(parseDriverLogBatchInput(input))),
    ready: base
      .input(DriverReadyInput)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) => context.onReady(parseDriverReadyInput(input))),
  },
  driverInstance: {
    nextCommand: base
      .input(DriverNextCommandInput)
      .output(DriverNextCommandOutput)
      .handler(({ context, input }) => context.onNextCommand(parseDriverNextCommandInput(input))),
    watchCommands: base
      .output(eventIterator(RuntimeCommand))
      .handler(({ context }) => context.onWatchCommands()),
  },
};

export type DriverRuntimeOrpcRouter = typeof runtimeOrpcRouter;
