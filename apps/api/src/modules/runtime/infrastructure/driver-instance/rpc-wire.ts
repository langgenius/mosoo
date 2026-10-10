import { DRIVER_PROTOCOL_VERSION } from "@mosoo/agent-driver/boot";
import { driverRuntimeRpcSchemas } from "@mosoo/agent-driver/orpc";
import type {
  DriverCommandUpdateInput,
  DriverCompletionInput,
  DriverEventBatchInput,
  DriverEventReceipt,
  DriverFailureInput,
  DriverExternalToolEffectObserveInput,
  DriverExternalToolEffectClaimInput,
  DriverExternalToolEffectClaimOutput,
  DriverExternalToolEffectSettleInput,
  DriverExternalToolEffectState,
  DriverHeartbeatInput,
  DriverHeartbeatOutput,
  DriverLogBatchInput,
  DriverLogBatchOutput,
  DriverNextCommandInput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { NonEmptyString, PrimitiveRecord } from "@mosoo/contracts/validation";
import { os } from "@orpc/server";
import { type } from "arktype";

const DriverHelloInputWire = type({
  capabilities: "unknown[]",
  driverVersion: NonEmptyString,
  pid: "number",
  protocolVersion: type.unit(DRIVER_PROTOCOL_VERSION),
  runtime: '"openai-runtime" | "claude-agent-sdk" | "acp-fallback" | "pi"',
  startedAt: "string",
});
export type DriverHelloInput = typeof DriverHelloInputWire.infer;

const DriverHelloOutputWire = type({
  acceptedCapabilities: "unknown[]",
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
export type DriverHelloOutput = typeof DriverHelloOutputWire.infer;

const DriverHeartbeatInputWire = type({
  at: "string.date.iso",
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
  "occurredAt?": "string | null | undefined",
});

const DriverEventBatchInputWire = type({
  driverInstanceId: NonEmptyString,
  events: DriverEventEnvelopeWire.array(),
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

const DriverNextCommandInputWire = type({
  driverInstanceId: NonEmptyString,
});

const DriverNextCommandOutputWire = type({
  command: type("null").or(RuntimeCommand),
});

export interface RuntimeOrpcContext {
  onObserveExternalToolEffect(
    input: DriverExternalToolEffectObserveInput,
  ): Promise<DriverExternalToolEffectState>;
  onClaimExternalToolEffect(
    input: DriverExternalToolEffectClaimInput,
  ): Promise<DriverExternalToolEffectClaimOutput>;
  onSettleExternalToolEffect(
    input: DriverExternalToolEffectSettleInput,
  ): Promise<DriverExternalToolEffectState>;
  onCommandUpdate(input: DriverCommandUpdateInput): Promise<{ ok: true }>;
  onCompleteRun(input: DriverCompletionInput): Promise<{ ok: true }>;
  onFailRun(input: DriverFailureInput): Promise<{ ok: true }>;
  onHeartbeat(input: DriverHeartbeatInput): Promise<DriverHeartbeatOutput>;
  onHello(input: DriverHelloInput): Promise<DriverHelloOutput>;
  onNextCommand(input: DriverNextCommandInput): Promise<{ command: RuntimeCommand | null }>;
  onPushEvents(input: DriverEventBatchInput): Promise<{ accepted: DriverEventReceipt[] }>;
  onPushLogs(input: DriverLogBatchInput): Promise<DriverLogBatchOutput>;
  onReady(input: DriverReadyInput): Promise<{ ok: true }>;
}

export function parseDriverEventBatchInput(
  input: typeof DriverEventBatchInputWire.infer,
): DriverEventBatchInput {
  return driverRuntimeRpcSchemas.driver.pushEvents.input.parse(input);
}

const base = os.$context<RuntimeOrpcContext>();

export const runtimeOrpcRouter = {
  driver: {
    observeExternalToolEffect: base
      .input(driverRuntimeRpcSchemas.driver.observeExternalToolEffect.input)
      .output(driverRuntimeRpcSchemas.driver.observeExternalToolEffect.output)
      .handler(async ({ context, input }) => context.onObserveExternalToolEffect(input)),
    claimExternalToolEffect: base
      .input(driverRuntimeRpcSchemas.driver.claimExternalToolEffect.input)
      .output(driverRuntimeRpcSchemas.driver.claimExternalToolEffect.output)
      .handler(async ({ context, input }) => context.onClaimExternalToolEffect(input)),
    settleExternalToolEffect: base
      .input(driverRuntimeRpcSchemas.driver.settleExternalToolEffect.input)
      .output(driverRuntimeRpcSchemas.driver.settleExternalToolEffect.output)
      .handler(async ({ context, input }) => context.onSettleExternalToolEffect(input)),
    commandUpdate: base
      .input(driverRuntimeRpcSchemas.driver.commandUpdate.input)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) => context.onCommandUpdate(input)),
    completeRun: base
      .input(driverRuntimeRpcSchemas.driver.completeRun.input)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) => context.onCompleteRun(input)),
    failRun: base
      .input(driverRuntimeRpcSchemas.driver.failRun.input)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) => context.onFailRun(input)),
    heartbeat: base
      .input(DriverHeartbeatInputWire)
      .output(DriverHeartbeatOutputWire)
      .handler(async ({ context, input }) => context.onHeartbeat(input)),
    hello: base
      .input(DriverHelloInputWire)
      .output(DriverHelloOutputWire)
      .handler(async ({ context, input }) => context.onHello(input)),
    pushEvents: base
      .input(DriverEventBatchInputWire)
      .output(driverRuntimeRpcSchemas.driver.pushEvents.output)
      .handler(async ({ context, input }) =>
        context.onPushEvents(parseDriverEventBatchInput(input)),
      ),
    pushLogs: base
      .input(DriverLogBatchInputWire)
      .output(DriverLogBatchOutputWire)
      .handler(async ({ context, input }) => context.onPushLogs(input)),
    ready: base
      .input(DriverReadyInputWire)
      .output(type({ ok: "true" }))
      .handler(async ({ context, input }) => context.onReady(input)),
  },
  driverInstance: {
    nextCommand: base
      .input(DriverNextCommandInputWire)
      .output(DriverNextCommandOutputWire)
      .handler(async ({ context, input }) => context.onNextCommand(input)),
  },
};
