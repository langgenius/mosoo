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
  DriverHeartbeatOutput,
  DriverHelloInput,
  DriverHelloOutput,
  DriverLogBatchInput,
  DriverLogBatchOutput,
  DriverNextCommandInput,
  DriverNextCommandOutput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import { DriverCapability } from "@mosoo/contracts/driver-instance";
import {
  ExternalToolEffectClaim,
  ExternalToolEffectClaimToken,
  ExternalToolEffectSettlement,
  ExternalToolEffectState,
} from "@mosoo/contracts/external-tool-effect";
import {
  InputStartCommandResult,
  McpExecuteCommandResult,
  RuntimeCommand,
} from "@mosoo/contracts/runtime-command";
import { DurableRunError } from "@mosoo/contracts/session-run";
import { NonEmptyString, PrimitiveRecord, parseSchemaValue } from "@mosoo/contracts/validation";
import {
  RUNTIME_EVENT_KINDS,
  RUNTIME_EVENT_SCHEMA_VERSION,
  parseRuntimeEventEnvelope,
} from "@mosoo/runtime-events";
import { eventIterator, os } from "@orpc/server";
import { type } from "arktype";

import { EVENT_BATCH_MAX_SIZE, LOG_BATCH_MAX_SIZE } from "./connections";
import type { HostDriverEventBatchInput } from "./event-types";

const PositiveSafeInteger = type("number.integer >= 1 & number.safe");
const NonNegativeSafeInteger = type("number.integer >= 0 & number.safe");
const DriverEventBatchMaxSizeWire = PositiveSafeInteger.narrow((size, context) =>
  size <= EVENT_BATCH_MAX_SIZE
    ? true
    : context.reject({ expected: `at most ${EVENT_BATCH_MAX_SIZE}` }),
);
const DriverCapabilitiesWire = DriverCapability.array().narrow((capabilities, context) =>
  new Set(capabilities.map(({ id }) => id)).size === capabilities.length
    ? true
    : context.reject({ expected: "unique capability ids" }),
);

const DriverHelloInputWire = type({
  capabilities: DriverCapabilitiesWire,
  driverVersion: NonEmptyString,
  pid: PositiveSafeInteger,
  protocolVersion: "3",
  runtime: '"openai-runtime" | "claude-agent-sdk" | "acp-fallback"',
  startedAt: NonEmptyString,
}).onUndeclaredKey("reject");

const DriverRunConfigWire = type({
  commandLeaseMs: NonNegativeSafeInteger,
  envPolicy: '"strict"',
  eventBatchMaxSize: DriverEventBatchMaxSizeWire,
  organizationPath: NonEmptyString,
}).onUndeclaredKey("reject");

const DriverHelloOutputWire = type({
  acceptedCapabilities: DriverCapabilitiesWire,
  connectionId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  heartbeatIntervalMs: "number.integer >= 250 & number.safe",
  runConfig: DriverRunConfigWire,
  runId: type("null").or(NonEmptyString),
}).onUndeclaredKey("reject");

const DriverHeartbeatInputWire = type({
  at: NonEmptyString,
  pid: PositiveSafeInteger,
  reason: '"interval" | "ping"',
}).onUndeclaredKey("reject");

const DriverHeartbeatOutputWire = type({
  heartbeatCount: NonNegativeSafeInteger,
  ok: "true",
}).onUndeclaredKey("reject");

const DriverReadyInputWire = type({
  at: NonEmptyString,
  driverInstanceId: NonEmptyString,
  pid: PositiveSafeInteger,
}).onUndeclaredKey("reject");

const RuntimeEventKindWire = type.enumerated(...RUNTIME_EVENT_KINDS);
const DriverRuntimeEventWire = type({
  actor: '"agent" | "api" | "driver" | "system" | "tool" | "user"',
  "correlationId?": "string",
  delivery: '"best_effort" | "lossless"',
  "driverInstanceId?": "string",
  id: NonEmptyString,
  kind: RuntimeEventKindWire,
  "native?": "unknown",
  occurredAt: NonEmptyString,
  origin: '"api" | "driver" | "file" | "runtime" | "system" | "viewer"',
  payload: "unknown",
  "receivedAt?": "string",
  "runId?": "string",
  "runtimeId?": "string",
  schemaVersion: `'${RUNTIME_EVENT_SCHEMA_VERSION}'`,
  sessionId: NonEmptyString,
  "sourceEventId?": "string",
  "traceId?": "string",
  visibility: '"owner_debug" | "participant" | "public" | "system_internal"',
}).onUndeclaredKey("reject");

const DriverEventEnvelopeWire = type({
  event: DriverRuntimeEventWire,
  eventId: NonEmptyString,
  "occurredAt?": "string | null | undefined",
}).onUndeclaredKey("reject");

const DriverEventReceiptWire = type({
  eventId: NonEmptyString,
  seq: NonNegativeSafeInteger,
  type: RuntimeEventKindWire,
}).onUndeclaredKey("reject");

const DriverEventBatchInputWire = type({
  driverInstanceId: NonEmptyString,
  events: DriverEventEnvelopeWire.array().atMostLength(EVENT_BATCH_MAX_SIZE),
}).onUndeclaredKey("reject");

const DriverEventBatchOutputWire = type({
  accepted: DriverEventReceiptWire.array(),
}).onUndeclaredKey("reject");

const DriverLogContextWire = type({
  "parentSpanId?": "string",
  "requestId?": "string",
  "sandboxId?": "string",
  "sessionId?": "string",
  "spanId?": "string",
  "traceId?": "string",
}).onUndeclaredKey("reject");

const DriverLogErrorWire = type({
  "code?": "string | number",
  message: "string",
  name: "string",
  "stack?": "string | null",
}).onUndeclaredKey("reject");

const DriverLogEntryWire = type({
  "context?": DriverLogContextWire,
  "error?": DriverLogErrorWire,
  "fields?": PrimitiveRecord,
  level: '"debug" | "error" | "info" | "trace" | "warn"',
  message: "string",
  "namespace?": "string | null",
  seq: NonNegativeSafeInteger,
  timestamp: NonEmptyString,
}).onUndeclaredKey("reject");

const DriverLogBatchInputWire = type({
  driverInstanceId: NonEmptyString,
  logs: DriverLogEntryWire.array().atMostLength(LOG_BATCH_MAX_SIZE),
}).onUndeclaredKey("reject");

const DriverLogBatchOutputWire = type({
  ok: "true",
}).onUndeclaredKey("reject");

const OkOutputWire = type({ ok: "true" }).onUndeclaredKey("reject");

const DriverCommandAcceptedInputWire = type({
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  status: '"accepted"',
}).onUndeclaredKey("reject");

const DriverCommandCancelledInputWire = type({
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  status: '"cancelled"',
}).onUndeclaredKey("reject");

const DriverCommandCompletedInputWire = type({
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  "result?": InputStartCommandResult.or(McpExecuteCommandResult),
  status: '"completed"',
}).onUndeclaredKey("reject");

const DriverCommandFailedInputWire = type({
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  error: DurableRunError,
  status: '"failed"',
}).onUndeclaredKey("reject");

const DriverCommandUpdateInputWire = DriverCommandAcceptedInputWire.or(
  DriverCommandCancelledInputWire,
)
  .or(DriverCommandCompletedInputWire)
  .or(DriverCommandFailedInputWire);

const DriverExternalToolEffectClaimInputWire = type({
  claimToken: ExternalToolEffectClaimToken,
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
}).onUndeclaredKey("reject");

const DriverExternalToolEffectObserveInputWire = type({
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
}).onUndeclaredKey("reject");

const DriverExternalToolEffectSettleInputWire = type({
  claimToken: ExternalToolEffectClaimToken,
  commandId: NonEmptyString,
  driverInstanceId: NonEmptyString,
  effectId: NonEmptyString,
  settlement: ExternalToolEffectSettlement,
}).onUndeclaredKey("reject");

const DriverNextCommandInputWire = type({
  driverInstanceId: NonEmptyString,
}).onUndeclaredKey("reject");

const DriverNextCommandOutputWire = type({
  command: type("null").or(RuntimeCommand),
}).onUndeclaredKey("reject");

const DriverCompletionInputWire = type({
  driverInstanceId: NonEmptyString,
  runId: NonEmptyString,
}).onUndeclaredKey("reject");

const DriverFailureInputWire = type({
  driverInstanceId: NonEmptyString,
  error: DurableRunError,
  runId: NonEmptyString,
}).onUndeclaredKey("reject");

type DriverEventBatchOutputWireValue = typeof DriverEventBatchOutputWire.infer;
type DriverHelloOutputWireValue = typeof DriverHelloOutputWire.infer;
type DriverNextCommandOutputWireValue = typeof DriverNextCommandOutputWire.infer;

export interface RuntimeOrpcContext {
  onCommandUpdate(input: DriverCommandUpdateInput): Promise<{ ok: true }>;
  onClaimExternalToolEffect(
    input: DriverExternalToolEffectClaimInput,
  ): Promise<DriverExternalToolEffectClaimOutput>;
  onCompleteRun(input: DriverCompletionInput): Promise<{ ok: true }>;
  onFailRun(input: DriverFailureInput): Promise<{ ok: true }>;
  onHeartbeat(input: DriverHeartbeatInput): Promise<DriverHeartbeatOutput>;
  onHello(input: DriverHelloInput): Promise<DriverHelloOutput>;
  onNextCommand(input: DriverNextCommandInput): Promise<DriverNextCommandOutput>;
  onObserveExternalToolEffect(
    input: DriverExternalToolEffectObserveInput,
  ): Promise<DriverExternalToolEffectState>;
  onPushEvents(input: HostDriverEventBatchInput): Promise<DriverEventBatchOutput>;
  onPushLogs(input: DriverLogBatchInput): Promise<DriverLogBatchOutput>;
  onReady(input: DriverReadyInput): Promise<{ ok: true }>;
  onSettleExternalToolEffect(
    input: DriverExternalToolEffectSettleInput,
  ): Promise<DriverExternalToolEffectState>;
  onWatchCommands(): AsyncIteratorObject<RuntimeCommand>;
}

export function parseDriverCommandUpdateInput(input: unknown): DriverCommandUpdateInput {
  return parseSchemaValue(DriverCommandUpdateInputWire, input);
}

export function parseDriverExternalToolEffectClaimInput(
  input: unknown,
): DriverExternalToolEffectClaimInput {
  return parseSchemaValue(DriverExternalToolEffectClaimInputWire, input);
}

export function parseDriverExternalToolEffectObserveInput(
  input: unknown,
): DriverExternalToolEffectObserveInput {
  return parseSchemaValue(DriverExternalToolEffectObserveInputWire, input);
}

export function parseDriverExternalToolEffectSettleInput(
  input: unknown,
): DriverExternalToolEffectSettleInput {
  return parseSchemaValue(DriverExternalToolEffectSettleInputWire, input);
}

export function parseDriverCompletionInput(input: unknown): DriverCompletionInput {
  return parseSchemaValue(DriverCompletionInputWire, input);
}

export function parseDriverEventBatchInput(input: unknown): HostDriverEventBatchInput {
  const batch = parseSchemaValue(DriverEventBatchInputWire, input);

  return {
    driverInstanceId: batch.driverInstanceId,
    events: batch.events.map((envelope) => ({
      event: parseRuntimeEventEnvelope(envelope.event),
      eventId: envelope.eventId,
      occurredAt: envelope.occurredAt,
    })),
  };
}

export function parseDriverFailureInput(input: unknown): DriverFailureInput {
  return parseSchemaValue(DriverFailureInputWire, input);
}

export function parseDriverHeartbeatInput(input: unknown): DriverHeartbeatInput {
  return parseSchemaValue(DriverHeartbeatInputWire, input);
}

export function parseDriverHeartbeatOutput(input: unknown): DriverHeartbeatOutput {
  return parseSchemaValue(DriverHeartbeatOutputWire, input);
}

export function parseDriverHelloInput(input: unknown): DriverHelloInput {
  return parseSchemaValue(DriverHelloInputWire, input);
}

export function parseDriverLogBatchInput(input: unknown): DriverLogBatchInput {
  return parseSchemaValue(DriverLogBatchInputWire, input);
}

export function parseDriverLogBatchOutput(input: unknown): DriverLogBatchOutput {
  return parseSchemaValue(DriverLogBatchOutputWire, input);
}

export function parseDriverNextCommandInput(input: unknown): DriverNextCommandInput {
  return parseSchemaValue(DriverNextCommandInputWire, input);
}

export function parseDriverReadyInput(input: unknown): DriverReadyInput {
  return parseSchemaValue(DriverReadyInputWire, input);
}

export function parseDriverEventBatchOutput(input: unknown): DriverEventBatchOutputWireValue {
  return parseSchemaValue(DriverEventBatchOutputWire, input);
}

export function parseDriverHelloOutput(input: unknown): DriverHelloOutputWireValue {
  return parseSchemaValue(DriverHelloOutputWire, input);
}

export function parseDriverNextCommandOutput(input: unknown): DriverNextCommandOutputWireValue {
  return parseSchemaValue(DriverNextCommandOutputWire, input);
}

function toDriverNextCommandOutputWire(
  output: DriverNextCommandOutput,
): DriverNextCommandOutputWireValue {
  return parseDriverNextCommandOutput(output);
}

const base = os.$context<RuntimeOrpcContext>();

export const runtimeOrpcRouter = {
  driver: {
    claimExternalToolEffect: base
      .input(DriverExternalToolEffectClaimInputWire)
      .output(ExternalToolEffectClaim)
      .handler(async ({ context, input }) =>
        parseSchemaValue(
          ExternalToolEffectClaim,
          await context.onClaimExternalToolEffect(parseDriverExternalToolEffectClaimInput(input)),
        ),
      ),
    commandUpdate: base
      .input(DriverCommandUpdateInputWire)
      .output(OkOutputWire)
      .handler(async ({ context, input }) =>
        context.onCommandUpdate(parseDriverCommandUpdateInput(input)),
      ),
    completeRun: base
      .input(DriverCompletionInputWire)
      .output(OkOutputWire)
      .handler(async ({ context, input }) =>
        context.onCompleteRun(parseDriverCompletionInput(input)),
      ),
    failRun: base
      .input(DriverFailureInputWire)
      .output(OkOutputWire)
      .handler(async ({ context, input }) => context.onFailRun(parseDriverFailureInput(input))),
    heartbeat: base
      .input(DriverHeartbeatInputWire)
      .output(DriverHeartbeatOutputWire)
      .handler(async ({ context, input }) =>
        parseDriverHeartbeatOutput(await context.onHeartbeat(parseDriverHeartbeatInput(input))),
      ),
    hello: base
      .input(DriverHelloInputWire)
      .output(DriverHelloOutputWire)
      .handler(async ({ context, input }) =>
        parseDriverHelloOutput(await context.onHello(parseDriverHelloInput(input))),
      ),
    observeExternalToolEffect: base
      .input(DriverExternalToolEffectObserveInputWire)
      .output(ExternalToolEffectState)
      .handler(async ({ context, input }) =>
        parseSchemaValue(
          ExternalToolEffectState,
          await context.onObserveExternalToolEffect(
            parseDriverExternalToolEffectObserveInput(input),
          ),
        ),
      ),
    pushEvents: base
      .input(DriverEventBatchInputWire)
      .output(DriverEventBatchOutputWire)
      .handler(async ({ context, input }) =>
        parseDriverEventBatchOutput(await context.onPushEvents(parseDriverEventBatchInput(input))),
      ),
    pushLogs: base
      .input(DriverLogBatchInputWire)
      .output(DriverLogBatchOutputWire)
      .handler(async ({ context, input }) => context.onPushLogs(parseDriverLogBatchInput(input))),
    ready: base
      .input(DriverReadyInputWire)
      .output(OkOutputWire)
      .handler(async ({ context, input }) => context.onReady(parseDriverReadyInput(input))),
    settleExternalToolEffect: base
      .input(DriverExternalToolEffectSettleInputWire)
      .output(ExternalToolEffectState)
      .handler(async ({ context, input }) =>
        parseSchemaValue(
          ExternalToolEffectState,
          await context.onSettleExternalToolEffect(parseDriverExternalToolEffectSettleInput(input)),
        ),
      ),
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
