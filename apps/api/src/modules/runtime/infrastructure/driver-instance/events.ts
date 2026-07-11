import {
  EventType,
  MOSOO_CUSTOM_EVENT,
  createServerCustomEvent,
  parseNullableSessionUsageSummary,
} from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId } from "@mosoo/id";
import type { AccountId, SessionId } from "@mosoo/id";
import {
  parseRuntimeEventEnvelope,
  readRuntimeEventFileChanges,
  readRuntimeEventPayload,
  readRuntimeEventPermissionRequest,
  readRuntimeEventString,
  readRuntimeRunPayload,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import type { DriverEventEnvelope } from "agent-driver/events";

import { createErrorLogContext, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import { withDisposedRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import {
  createRuntimeOutputContentSha256,
  createRuntimeOutputParentPath,
  fileStore,
} from "../../../files/application/file-store";
import {
  applyAgUiEventToSessionLiveState,
  loadSessionViewerState,
  appRuntimeEventToSessionDeliveryEvents,
} from "../../../sessions/application/session-live-state.service";
import type {
  SessionDeliveryEvent,
  SessionLiveState,
} from "../../../sessions/application/session-live-state.service";
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import { upsertNativeResumeRef } from "../native-resume-ref.repository";
import { getRuntimeSubjectKeepAliveHandle } from "../runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { getRuntimeConversationSession } from "../runtime-subject-lifecycle/runtime-subject-store";
import { readSandboxFileBytes } from "../sandbox-file-bytes";
import type { ExecutionSessionHandle } from "../sandbox-handles";
import {
  assertRuntimeEventMatchesDriverEnvelope,
  assertRuntimeEventMatchesDriverLink,
} from "./event-link-assertion";
import {
  createBaseLiveState,
  normalizeRuntimeSessionInfoTitle,
  readPermissionRequestViews,
  readRuntimeDriverRunTransition,
  removePermissionRequest,
  upsertPermissionRequest,
} from "./event-projection";
import type {
  ProjectedRuntimeEventRecord,
  AppRuntimeDriverEventsResult,
  RuntimeDriverRunTransition,
  RuntimeSessionLink,
} from "./event-types";
import { readNativeResumeRef } from "./native-resume-ref-event";
import {
  RUNTIME_SESSION_OUTPUT_DIR_NAME,
  RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES,
  getRuntimeSessionOutputDirectory,
  guessRuntimeSessionOutputContentType,
  readRuntimeSessionOutputListing,
  toRuntimeSessionOutputArtifactPath,
  toRuntimeSessionOutputFile,
} from "./runtime-session-outputs";
import { getRuntimeSessionLink } from "./session-link.repository";
export type {
  AppRuntimeDriverEventsResult,
  RuntimeDriverRunTransition,
  RuntimeSessionLink,
} from "./event-types";
export { persistProjectedRuntimeDriverEvents } from "./event-persistence";
export { getRuntimeSessionLink } from "./session-link.repository";
export {
  recordDriverInstanceCompletion,
  recordDriverInstanceFailure,
} from "./terminal-driver-events";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function resolveRuntimeOutputCreator(link: RuntimeSessionLink): AccountId | null {
  const actorId = link.executionOwnerId ?? link.callerId ?? link.creatorId;

  if (!isTruthy(actorId)) {
    return null;
  }

  return parsePlatformId<AccountId>(actorId, "runtime output creator account ID");
}

function readRuntimeFileChangeContentType(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const contentType = metadata?.["contentType"] ?? metadata?.["mimeType"];
  return typeof contentType === "string" && contentType.trim().length > 0 ? contentType : null;
}

function createRuntimeSessionOutputListCommand(outputDir: string): string {
  const quotedOutputDir = quoteShellArg(outputDir);
  const command = [
    `if [ ! -d ${quotedOutputDir} ]; then exit 0; fi`,
    `cd ${quotedOutputDir}`,
    `find . -type f -print | sed 's#^\\./##' | sort | head -n ${RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES}`,
  ].join(" && ");

  return `sh -lc ${quoteShellArg(command)}`;
}

async function listRuntimeSessionOutputFiles(
  handle: ExecutionSessionHandle,
  outputDir: string,
): Promise<string[]> {
  const result = await handle.exec(createRuntimeSessionOutputListCommand(outputDir));

  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Failed to list runtime session outputs in ${outputDir}.`,
    );
  }

  return readRuntimeSessionOutputListing(result.stdout);
}

async function recordRuntimeSessionOutputFile(input: {
  bindings: ApiBindings;
  body: Uint8Array;
  contentType: string | null;
  createdBy: AccountId;
  existingArtifacts: Set<string>;
  path: string;
  recordedArtifacts: Set<string>;
  sessionId: SessionId;
}): Promise<void> {
  const contentSha256 = await createRuntimeOutputContentSha256(input.body);
  const artifactKey = createRuntimeOutputParentPath(input.path, contentSha256);

  if (input.recordedArtifacts.has(artifactKey) || input.existingArtifacts.has(artifactKey)) {
    return;
  }

  await fileStore.recordRuntimeOutput({
    bindings: input.bindings,
    body: input.body,
    contentSha256,
    contentType: input.contentType,
    createdBy: input.createdBy,
    path: input.path,
    sessionId: input.sessionId,
  });
  input.recordedArtifacts.add(artifactKey);
  input.existingArtifacts.add(artifactKey);
}

function readTerminalPendingToolResult(event: RuntimeEventEnvelope): string | null {
  if (event.kind === "run.failed") {
    const run = readRuntimeRunPayload(event).run;
    const message = run?.error?.message ?? "Run failed before the tool returned a result.";
    return `Tool failed before returning a result: ${message}`;
  }

  if (event.kind === "run.cancelled") {
    return "Tool was cancelled before returning a result.";
  }

  return null;
}

function createPendingToolResultEvents(
  state: SessionLiveState,
  event: RuntimeEventEnvelope,
): SessionDeliveryEvent[] {
  const content = readTerminalPendingToolResult(event);

  if (content === null) {
    return [];
  }

  return state.messages.flatMap((message) => {
    const completedToolCallIds = new Set(
      message.segments.flatMap((segment) =>
        segment.kind === "tool_result" ? [segment.toolCallId] : [],
      ),
    );

    return message.segments.flatMap((segment) => {
      if (segment.kind !== "tool_use" || completedToolCallIds.has(segment.toolCallId)) {
        return [];
      }

      return [
        {
          content,
          messageId: message.id,
          toolCallId: segment.toolCallId,
          type: EventType.TOOL_CALL_RESULT,
        },
        {
          toolCallId: segment.toolCallId,
          type: EventType.TOOL_CALL_END,
        },
      ];
    });
  });
}

async function recordRuntimeFileChanges(input: {
  bindings: ApiBindings;
  event: RuntimeEventEnvelope;
  link: RuntimeSessionLink;
}): Promise<void> {
  const sessionId = input.link.sessionId;
  const sandboxId = input.link.sandboxId;
  const createdBy = resolveRuntimeOutputCreator(input.link);
  const changes = readRuntimeEventFileChanges(input.event).filter(
    (change) => change.change === "upsert",
  );

  if (changes.length === 0) {
    return;
  }

  if (sessionId === null || sandboxId === null || createdBy === null) {
    logWarn("runtime.file_artifact.record_skipped", {
      driverInstanceId: input.event.driverInstanceId ?? null,
      hasCreatedBy: createdBy !== null,
      sandboxId,
      sessionId,
    });
    return;
  }

  const conversation = await getRuntimeConversationSession(input.bindings.DB, sessionId);

  if (conversation === null) {
    logWarn("runtime.file_artifact.record_skipped.missing_session", {
      sandboxId,
      sessionId,
    });
    return;
  }

  const outputChanges = changes.flatMap((change) => {
    const outputFile = toRuntimeSessionOutputFile({
      contentType: readRuntimeFileChangeContentType(change.metadata),
      cwd: conversation.cwd,
      path: change.path,
    });

    return outputFile === null ? [] : [outputFile];
  });

  if (outputChanges.length === 0) {
    return;
  }

  const parsedSessionId = parsePlatformId<SessionId>(sessionId, "runtime output session ID");
  const existingArtifacts = new Set(
    await fileStore.listReadySessionArtifactKeys(input.bindings.DB, parsedSessionId),
  );
  const recordedArtifacts = new Set<string>();

  await withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(input.bindings, sandboxId),
    async (sandbox) => {
      const sandboxSession = await sandbox.getSession(conversation.sandboxSessionId);

      for (const outputFile of outputChanges) {
        try {
          await recordRuntimeSessionOutputFile({
            bindings: input.bindings,
            body: await readSandboxFileBytes(sandboxSession, outputFile.readPath),
            contentType: outputFile.contentType,
            createdBy,
            existingArtifacts,
            path: outputFile.artifactPath,
            recordedArtifacts,
            sessionId: parsedSessionId,
          });
        } catch (error) {
          logWarn("runtime.file_artifact.record_failed", {
            ...createErrorLogContext(error),
            path: outputFile.artifactPath,
            sandboxId,
            sessionId,
          });
        }
      }
    },
  );
}

async function recordRuntimeSessionOutputDirectory(input: {
  bindings: ApiBindings;
  event: RuntimeEventEnvelope;
  link: RuntimeSessionLink;
}): Promise<void> {
  const sessionId = input.link.sessionId;
  const sandboxId = input.link.sandboxId;
  const createdBy = resolveRuntimeOutputCreator(input.link);

  if (sessionId === null || sandboxId === null || createdBy === null) {
    return;
  }

  const parsedSessionId = parsePlatformId<SessionId>(sessionId, "runtime output session ID");
  let conversation;

  try {
    conversation = await getRuntimeConversationSession(input.bindings.DB, parsedSessionId);
  } catch (error) {
    logWarn("runtime.file_artifact.output_scan_session_lookup_failed", {
      ...createErrorLogContext(error),
      driverInstanceId: input.event.driverInstanceId ?? null,
      sandboxId,
      sessionId,
    });
    return;
  }

  if (conversation === null) {
    return;
  }

  try {
    await withDisposedRpcResource(
      await getRuntimeSubjectKeepAliveHandle(input.bindings, sandboxId),
      async (sandbox) => {
        const sandboxSession = await sandbox.getSession(conversation.sandboxSessionId);
        const outputDir = getRuntimeSessionOutputDirectory(conversation.cwd);
        const outputPaths = await listRuntimeSessionOutputFiles(sandboxSession, outputDir);

        if (outputPaths.length === 0) {
          return;
        }

        const existingArtifacts = new Set(
          await fileStore.listReadySessionArtifactKeys(input.bindings.DB, parsedSessionId),
        );
        const recordedArtifacts = new Set<string>();

        for (const outputPath of outputPaths) {
          const artifactPath = toRuntimeSessionOutputArtifactPath(outputPath);

          try {
            await recordRuntimeSessionOutputFile({
              bindings: input.bindings,
              body: await readSandboxFileBytes(sandboxSession, `${outputDir}/${outputPath}`),
              contentType: guessRuntimeSessionOutputContentType(outputPath),
              createdBy,
              existingArtifacts,
              path: artifactPath,
              recordedArtifacts,
              sessionId: parsedSessionId,
            });
          } catch (error) {
            logWarn("runtime.file_artifact.output_record_failed", {
              ...createErrorLogContext(error),
              path: artifactPath,
              sandboxId,
              sessionId,
            });
          }
        }
      },
    );
  } catch (error) {
    logWarn("runtime.file_artifact.output_scan_failed", {
      ...createErrorLogContext(error),
      driverInstanceId: input.event.driverInstanceId ?? null,
      outputDir: `${RUNTIME_SESSION_OUTPUT_DIR_NAME}/`,
      sandboxId,
      sessionId,
    });
  }
}

export async function appRuntimeDriverEvents(
  bindings: ApiBindings,
  input: {
    assertCurrentConnection?: () => void;
    currentLiveState?: SessionLiveState | null;
    events: readonly DriverEventEnvelope[];
    driverInstanceId: DriverInstanceId;
    link?: RuntimeSessionLink | null;
  },
): Promise<AppRuntimeDriverEventsResult> {
  const database = bindings.DB;
  const link = input.link ?? (await getRuntimeSessionLink(database, input.driverInstanceId));

  if (!isTruthy(link.sessionId)) {
    throw new Error("Runtime driver event session link is missing a session id.");
  }

  if (
    input.events.some((envelope) => envelope.event.kind.startsWith("run.")) &&
    !isTruthy(link.sessionRunId)
  ) {
    throw new Error("Runtime driver run event is missing a session run id.");
  }

  const currentLiveState =
    input.currentLiveState ??
    (await loadStoredRuntimeLiveState(database, {
      driverInstanceId: input.driverInstanceId,
      link,
    }));

  let nextLiveState = currentLiveState;
  let liveStateChanged = false;
  let finalAssistantMessage: AppRuntimeDriverEventsResult["finalAssistantMessage"] = null;
  let sessionTitle: string | null = null;
  let usage: AppRuntimeDriverEventsResult["usage"] = null;
  const runtimeEvents: ProjectedRuntimeEventRecord[] = [];
  const sessionDeliveryEvents: AppRuntimeDriverEventsResult["sessionDeliveryEvents"] = [];
  const transitions: RuntimeDriverRunTransition[] = [];

  function appendCanonicalEvent(source: DriverEventEnvelope, event: RuntimeEventEnvelope): void {
    runtimeEvents.push({
      event,
      occurredAt:
        typeof source.occurredAt === "number" && Number.isFinite(source.occurredAt)
          ? source.occurredAt
          : null,
      sourceEventId: source.eventId.trim().length > 0 ? source.eventId : null,
    });
  }

  function appendSessionDeliveryEvent(
    source: DriverEventEnvelope,
    deliveryEvent: SessionDeliveryEvent,
  ): void {
    sessionDeliveryEvents.push({
      event: deliveryEvent,
      occurredAt:
        typeof source.occurredAt === "number" && Number.isFinite(source.occurredAt)
          ? source.occurredAt
          : null,
      sourceEventId: source.eventId.trim().length > 0 ? source.eventId : null,
    });
  }

  for (const envelope of input.events) {
    input.assertCurrentConnection?.();
    const event = parseRuntimeEventEnvelope(envelope.event);
    assertRuntimeEventMatchesDriverLink(event, {
      driverInstanceId: input.driverInstanceId,
      link,
    });
    assertRuntimeEventMatchesDriverEnvelope(event, {
      eventId: envelope.eventId,
    });
    appendCanonicalEvent(envelope, event);

    if (event.kind === "runtime.resume.updated") {
      const nativeResumeRef = readNativeResumeRef(event);

      if (nativeResumeRef === null) {
        continue;
      }

      const policy = link.sandboxKind === null ? null : getRuntimeKindPolicy(link.sandboxKind);

      if (policy?.nativeResume.persistence !== "platform") {
        logInfo("runtime.native_resume_ref.ignored", {
          driverInstanceId: input.driverInstanceId,
          kind: nativeResumeRef.kind,
          runtimeId: nativeResumeRef.runtimeId,
          sandboxKind: link.sandboxKind,
          sandboxSubjectKind: link.sandboxSubjectKind,
          sessionId: link.sessionId,
          sessionRunId: link.sessionRunId,
        });
        continue;
      }

      if (link.sessionRunId === null) {
        logInfo("runtime.native_resume_ref.deferred", {
          driverInstanceId: input.driverInstanceId,
          kind: nativeResumeRef.kind,
          runtimeId: nativeResumeRef.runtimeId,
          sessionId: link.sessionId,
        });
        continue;
      }

      input.assertCurrentConnection?.();
      await upsertNativeResumeRef(database, {
        driverInstanceId: input.driverInstanceId,
        nativeResumeRef,
        sessionId: link.sessionId,
        sessionRunId: link.sessionRunId,
      });
      logInfo("runtime.native_resume_ref.observed", {
        driverInstanceId: input.driverInstanceId,
        kind: nativeResumeRef.kind,
        runtimeId: nativeResumeRef.runtimeId,
        sessionId: link.sessionId,
        sessionRunId: link.sessionRunId,
      });
      continue;
    }

    if (event.kind === "file.change.updated" || event.kind === "file.changed") {
      await recordRuntimeFileChanges({
        bindings,
        event,
        link,
      });
      continue;
    }

    if (event.kind === "run.completed") {
      const payload = readRuntimeEventPayload(event);
      const finalMessageId = readRuntimeEventString(payload, "finalMessageId");
      const finalMessageText = readRuntimeEventString(payload, "finalMessageText");
      finalAssistantMessage =
        finalMessageId === null || finalMessageText === null
          ? null
          : { id: finalMessageId, text: finalMessageText };
      await recordRuntimeSessionOutputDirectory({
        bindings,
        event,
        link,
      });
    }

    if (event.kind === "permission.requested") {
      const request = readRuntimeEventPermissionRequest(event);

      if (request) {
        const permissionsUpdatedEvent = createServerCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name,
          {
            permissionRequests: upsertPermissionRequest(nextLiveState.permissionRequests, request),
          },
        );

        nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, permissionsUpdatedEvent);
        appendSessionDeliveryEvent(envelope, permissionsUpdatedEvent);
        liveStateChanged = true;
      }

      continue;
    }

    if (event.kind === "permission.resolved") {
      const payload = readRuntimeEventPayload(event);
      const requestId = readRuntimeEventString(payload, "requestId");
      const permissionRequests =
        readPermissionRequestViews(payload["permissionRequests"]) ??
        (requestId === null
          ? null
          : removePermissionRequest(nextLiveState.permissionRequests, requestId));

      if (permissionRequests !== null) {
        const permissionsUpdatedEvent = createServerCustomEvent(
          MOSOO_CUSTOM_EVENT.sessionPermissionsUpdated.name,
          {
            permissionRequests,
          },
        );

        nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, permissionsUpdatedEvent);
        appendSessionDeliveryEvent(envelope, permissionsUpdatedEvent);
        liveStateChanged = true;
      }

      continue;
    }

    const liveEvents = [
      ...createPendingToolResultEvents(nextLiveState, event),
      ...appRuntimeEventToSessionDeliveryEvents(event),
    ];

    const setSessionTitle = (title: string | null): void => {
      sessionTitle = title;
    };
    const setUsage = (nextUsage: AppRuntimeDriverEventsResult["usage"]): void => {
      usage = nextUsage;
    };

    appendRuntimeDriverCanonicalSideEffects(event, {
      setSessionTitle,
      setUsage,
      transitions,
    });

    for (const liveEvent of liveEvents) {
      nextLiveState = applyAgUiEventToSessionLiveState(nextLiveState, liveEvent);
      appendSessionDeliveryEvent(envelope, liveEvent);
      liveStateChanged = true;
    }
  }

  return {
    finalAssistantMessage,
    link,
    liveStateChanged,
    nextLiveState,
    runtimeEvents,
    sessionTitle,
    sessionDeliveryEvents,
    transitions,
    usage,
  };
}

function appendRuntimeDriverCanonicalSideEffects(
  event: RuntimeEventEnvelope,
  output: {
    setSessionTitle: (title: string | null) => void;
    setUsage: (usage: AppRuntimeDriverEventsResult["usage"]) => void;
    transitions: RuntimeDriverRunTransition[];
  },
): void {
  if (event.kind === "session.info.updated") {
    output.setSessionTitle(
      normalizeRuntimeSessionInfoTitle(
        readRuntimeEventString(readRuntimeEventPayload(event), "title"),
      ),
    );
    return;
  }

  if (event.kind === "usage.updated") {
    output.setUsage(parseNullableSessionUsageSummary(event.payload));
    return;
  }

  const transition = readRuntimeDriverRunTransition(event);

  if (transition !== null) {
    output.transitions.push(transition);
  }
}

async function loadStoredRuntimeLiveState(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    link: RuntimeSessionLink;
  },
): Promise<SessionLiveState> {
  if (isTruthy(input.link.sessionId)) {
    const viewerId = input.link.callerId ?? input.link.creatorId;

    if (!isTruthy(viewerId)) {
      throw new Error("Runtime session link is missing a viewer principal.");
    }

    return loadSessionViewerState(database, {
      sessionId: input.link.sessionId,
      viewerId,
    });
  }

  return createBaseLiveState({
    callerId: input.link.callerId,
    creatorId: input.link.creatorId,
    driverInstanceId: input.driverInstanceId,
    sessionId: input.link.sessionId,
  });
}
