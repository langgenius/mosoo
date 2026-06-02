import { type } from "arktype";

import { NullableString, OptionalNullableString } from "./ag-ui-session-schema-primitives";
import { MOSOO_CUSTOM_EVENT } from "./custom-event-registry";
import {
  SessionCommandOptionSchema,
  SessionConfigOptionSchema,
  SessionModeOptionSchema,
  SessionPermissionRequestViewSchema,
  SessionReadinessSnapshotViewSchema,
  SessionRunViewSchema,
  SessionUsageSummarySchema,
  SessionViewFileSchema,
  SessionViewPlanEntrySchema,
} from "./session-live-state-schema";

function eventNameLiteral(name: string): `"${string}"` {
  return JSON.stringify(name) as `"${string}"`;
}

export const MosooViewerCustomEventSchema = type({
  name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionSyncRequest.name),
  type: '"CUSTOM"',
  value: {
    reason: '"manual" | "reconnect"',
  },
});
export type MosooViewerCustomEventSchema = typeof MosooViewerCustomEventSchema.infer;

const MosooSessionFileDeleteChangeSchema = type({
  change: '"delete"',
  fileId: "string",
});

const MosooSessionFileUpsertChangeSchema = type({
  change: '"upsert"',
  file: SessionViewFileSchema,
});

const MosooSessionFilesUpdatedValueSchema = type({
  "change?": type.or(MosooSessionFileDeleteChangeSchema, MosooSessionFileUpsertChangeSchema),
  "files?": SessionViewFileSchema.array(),
});

const MosooSessionConfigTraceMcpServerSchema = type({
  authorizationState: "string",
  credentialRef: '"absent" | "redacted"',
  name: "string",
  serverId: "string",
});

const MosooSessionConfigTraceSpaceAliasSchema = type({
  aliasPath: "string",
  globalMountPath: "string",
  spaceId: "string",
  spaceName: "string",
});

const MosooSessionConfigTraceBootPayloadSchema = type({
  credentialRefs: type('"redacted"').array(),
  cwd: "string",
  mcpServers: MosooSessionConfigTraceMcpServerSchema.array(),
  model: "string",
  nativeResumeRef: '"absent" | "present"',
  provider: "string",
  runtimeId: "string",
  runtimeTransport: "string",
  spaceAliases: MosooSessionConfigTraceSpaceAliasSchema.array(),
});

const MosooSessionConfigTraceValueSchema = type({
  agentId: "string",
  configRevisionId: NullableString,
  deploymentVersionId: NullableString,
  deploymentVersionNumber: "number | null",
  driverBootPayload: MosooSessionConfigTraceBootPayloadSchema,
  environmentId: "string",
  environmentRevisionId: "string",
  runId: NullableString,
  sessionId: "string",
});

const MosooSessionRuntimeTimingPhaseSchema = type({
  durationMs: "number",
  name: "string",
});

const MosooSessionRuntimeTimingValueSchema = type({
  completedAtMs: "number",
  path: '"cold" | "warm" | "prewarm" | "unknown"',
  phases: MosooSessionRuntimeTimingPhaseSchema.array(),
  runId: NullableString,
  sessionId: "string",
  source: '"api" | "driver"',
  stage: '"context_hydration" | "driver_backend" | "driver_turn" | "prepare_run" | "prewarm"',
  startedAtMs: "number",
  totalMs: "number",
  traceId: NullableString,
});

const MosooSessionRuntimeTimelineValueSchema = type({
  completedAtMs: "number",
  durationMs: "number",
  path: '"cold" | "warm" | "prewarm" | "unknown"',
  runId: NullableString,
  sessionId: "string",
  source: '"api" | "driver"',
  stage: '"context_hydration" | "driver_backend" | "driver_turn" | "prepare_run" | "prewarm"',
  startedAtMs: "number",
  traceId: NullableString,
});

const SpaceWriteActorSchema = type({
  id: "string",
  type: '"agent" | "user"',
});

const SpaceFileLockHolderSchema = type({
  displayName: NullableString,
  id: "string",
  type: '"agent" | "user"',
});

const SpaceFileLockViewSchema = type({
  expiresAt: "number",
  holder: SpaceFileLockHolderSchema,
  path: "string",
});

export const MosooServerCustomEventSchema = type.or(
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.agentReady.name),
    type: '"CUSTOM"',
    value: {
      agentId: "string",
      operation: '"recreateSandbox" | "resetAgentState" | "restartDriver"',
      readyAt: "string",
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.agentUpdating.name),
    type: '"CUSTOM"',
    value: {
      agentId: "string",
      operation: '"recreateSandbox" | "resetAgentState" | "restartDriver"',
      startedAt: "string",
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionCommandsUpdated.name),
    type: '"CUSTOM"',
    value: {
      commands: SessionCommandOptionSchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionConfigUpdated.name),
    type: '"CUSTOM"',
    value: {
      configOptions: SessionConfigOptionSchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionConfigTrace.name),
    type: '"CUSTOM"',
    value: MosooSessionConfigTraceValueSchema,
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionRuntimeTiming.name),
    type: '"CUSTOM"',
    value: MosooSessionRuntimeTimingValueSchema,
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionRuntimeTimelineUpdated.name),
    type: '"CUSTOM"',
    value: MosooSessionRuntimeTimelineValueSchema,
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionFilesUpdated.name),
    type: '"CUSTOM"',
    value: MosooSessionFilesUpdatedValueSchema,
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionInfraRescheduling.name),
    type: '"CUSTOM"',
    value: {
      lastSeen: NullableString,
      reason: NullableString,
      rescheduleStartedAt: "string",
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionInfraRunning.name),
    type: '"CUSTOM"',
    value: {
      resumedAt: "string",
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionModeUpdated.name),
    type: '"CUSTOM"',
    value: {
      currentModeId: NullableString,
      visibleModes: SessionModeOptionSchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name),
    type: '"CUSTOM"',
    value: {
      permissionRequests: SessionPermissionRequestViewSchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionPlanUpdated.name),
    type: '"CUSTOM"',
    value: {
      plan: SessionViewPlanEntrySchema.array(),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionReadiness.name),
    type: '"CUSTOM"',
    value: {
      readiness: SessionReadinessSnapshotViewSchema,
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionRunUpdated.name),
    type: '"CUSTOM"',
    value: {
      lifecycle: '"IDLE" | "RUNNING" | "RESCHEDULING" | "TERMINATED"',
      run: SessionRunViewSchema,
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionStopped.name),
    type: '"CUSTOM"',
    value: {
      "heartbeatMissedMs?": "number | null",
      "lastSeen?": OptionalNullableString,
      "message?": OptionalNullableString,
      reason: "string",
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionUsageUpdated.name),
    type: '"CUSTOM"',
    value: {
      usage: type("null").or(SessionUsageSummarySchema),
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.sessionInfoUpdated.name),
    type: '"CUSTOM"',
    value: {
      "title?": OptionalNullableString,
      "updatedAt?": OptionalNullableString,
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.spaceLockAcquired.name),
    type: '"CUSTOM"',
    value: {
      lock: SpaceFileLockViewSchema,
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.spaceLockReleased.name),
    type: '"CUSTOM"',
    value: {
      lock: SpaceFileLockViewSchema,
    },
  }),
  type({
    name: eventNameLiteral(MOSOO_CUSTOM_EVENT.spaceWriteStale.name),
    type: '"CUSTOM"',
    value: {
      "actor?": type("undefined").or(SpaceWriteActorSchema),
      "current_etag?": "string | undefined",
      path: "string",
      reason: '"deleted" | "modified"',
      "session_id?": "string | undefined",
      "turn_id?": "string | undefined",
      type: eventNameLiteral(MOSOO_CUSTOM_EVENT.spaceWriteStale.name),
    },
  }),
);
export type MosooServerCustomEventSchema = typeof MosooServerCustomEventSchema.infer;

export const MosooCustomEventSchema = type.or(
  MosooViewerCustomEventSchema,
  MosooServerCustomEventSchema,
);
export type MosooCustomEventSchema = typeof MosooCustomEventSchema.infer;
