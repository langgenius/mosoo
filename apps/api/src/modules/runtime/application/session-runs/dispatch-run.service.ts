import { parsePlatformId } from "@mosoo/id";
import type { AgentId, DriverInstanceId, FileId, SessionId, SessionRunId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";
import type { DriverBootPayload, DriverRuntime } from "agent-driver/boot";

import { logError, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import {
  appendSessionRuntimeEvents,
  createSessionRuntimeEvent,
} from "../../../sessions/application/session-event-write.service";
import { createSandboxExecutionPlaneAdapter } from "../../infrastructure/execution-plane/sandbox-execution-plane-adapter";
import type { RuntimeExecutionPlaneRunLease } from "../execution-plane/execution-plane-adapter";
import {
  appendRuntimeDiagnosticEvents,
  toRuntimeDiagnosticBaseValue,
} from "../runtime-diagnostic-events";
import type { RuntimeDiagnosticEventInput } from "../runtime-diagnostic-events";
import { buildSessionConfigTraceValue } from "../session-definition/session-config-trace-event";
import type { HydratedSessionRunContext } from "../session-definition/session-execution.types";
import { cleanupDispatchedDriver } from "./dispatch-run-cleanup.service";
import { withPreReadyRetry } from "./pre-ready-retry";
import { describeRunError } from "./run-error-message";
import { persistSessionRunSkills } from "./session-run-skill-snapshot.repository";
import {
  acquireSessionRunDispatch,
  SessionRunNoLongerActiveError,
  ensureSessionRunIsActive,
  getSessionRunState,
  updateSessionRunStatusIfActive,
} from "./session-run-state.repository";
import {
  createFailedSessionRunRuntimeEvent,
  createSessionRunUpdatedEvent,
} from "./session-run-view-events.service";
import {
  appendSessionRuntimeTimingEventBestEffort,
  createRuntimeTimingRecorder,
} from "./session-runtime-timing";

const executionPlane = createSandboxExecutionPlaneAdapter();

const PRE_READY_DISPATCH_RETRY_LIMIT = 1;

async function appendBootPayloadRuntimeEvents(
  bindings: ApiBindings,
  input: {
    bootPayload: DriverBootPayload;
    sessionId: SessionId;
    traceId: string;
  },
): Promise<void> {
  const configRevision = input.bootPayload.execution.configRevision;
  const agentId = parsePlatformId<AgentId>(
    configRevision.agentId,
    "Driver boot payload config agent ID",
  );
  const runtimeBase = toRuntimeDiagnosticBaseValue({
    agentId,
    sessionId: input.sessionId,
    traceId: input.traceId,
  });
  const events: RuntimeDiagnosticEventInput[] = [];

  if (
    configRevision.deploymentVersionId !== null &&
    configRevision.deploymentVersionNumber !== null
  ) {
    events.push({
      eventName: RUNTIME_DIAGNOSTIC_EVENT.configDeploymentVersionApplied.name,
      value: {
        ...runtimeBase,
        deploymentVersionId: configRevision.deploymentVersionId,
        deploymentVersionNumber: configRevision.deploymentVersionNumber,
      },
    });
  }

  events.push({
    eventName: RUNTIME_DIAGNOSTIC_EVENT.configManifestRendered.name,
    value: {
      ...runtimeBase,
      mcpServerCount: input.bootPayload.execution.session.mcpServers.length,
      model: input.bootPayload.execution.model,
      provider: input.bootPayload.execution.provider,
      skillCount: input.bootPayload.execution.skills.length,
    },
  });

  events.push({
    eventName: RUNTIME_DIAGNOSTIC_EVENT.configCredentialResolved.name,
    value: {
      ...runtimeBase,
      provider: input.bootPayload.execution.provider,
    },
  });

  await appendRuntimeDiagnosticEvents(bindings, {
    events,
    sessionId: input.sessionId,
  });
}

export async function dispatchSessionRun(
  bindings: ApiBindings,
  requestUrl: string,
  input: {
    attachmentIds: FileId[];
    builtInTools: HydratedSessionRunContext["builtInTools"];
    prompt: string;
    profile: HydratedSessionRunContext["profile"] & {
      runtimeId: DriverRuntime;
    };
    resolvedMcpServers: HydratedSessionRunContext["mcpServers"];
    resolvedSkillCatalog: HydratedSessionRunContext["skillCatalog"];
    resolvedSkills: HydratedSessionRunContext["skills"];
    sessionId: SessionId;
    sessionRunId: SessionRunId;
    traceId: string;
  },
): Promise<void> {
  const sandboxId = input.profile.sandbox.id;
  let driverInstanceId: DriverInstanceId | null = null;
  let prepareTimingEventPromise: Promise<void> = Promise.resolve();
  let runLease: RuntimeExecutionPlaneRunLease | null = null;

  try {
    await ensureSessionRunIsActive(bindings.DB, input.sessionRunId);

    const bootingRun = await acquireSessionRunDispatch(bindings.DB, input.sessionRunId);

    if (!bootingRun) {
      const state = await getSessionRunState(bindings.DB, input.sessionRunId);

      logInfo("session.run.dispatch.skipped", {
        driverInstanceId,
        runId: input.sessionRunId,
        sandboxId,
        sessionId: input.sessionId,
        status: state?.status ?? null,
        traceId: input.traceId,
      });

      return;
    }

    // Only the dispatch winner writes run state; the losing path above must
    // stay write-free so it cannot fail a run the winner is provisioning.
    await persistSessionRunSkills(bindings.DB, input.sessionRunId, input.resolvedSkills);

    await appendSessionRuntimeEvents({
      bindings,
      events: [createSessionRunUpdatedEvent(bootingRun, input.sessionId)],
      sessionId: input.sessionId,
    });

    const attemptPrepareAndDispatch = async (): Promise<RuntimeExecutionPlaneRunLease> => {
      const preparedRunLease = await executionPlane.prepareRun(bindings, requestUrl, {
        attachmentIds: input.attachmentIds,
        builtInTools: input.builtInTools,
        onBootPayloadPrepared: async ({ bootPayload }) => {
          const configTraceValue = buildSessionConfigTraceValue(bootPayload);

          await appendSessionRuntimeEvents({
            bindings,
            events: [
              createSessionRuntimeEvent({
                kind: "runtime.config.updated",
                payload: configTraceValue,
                runId: input.sessionRunId,
                sessionId: input.sessionId,
                traceId: input.traceId,
                visibility: "owner_debug",
              }),
            ],
            sessionId: input.sessionId,
          });
          await appendBootPayloadRuntimeEvents(bindings, {
            bootPayload,
            sessionId: input.sessionId,
            traceId: input.traceId,
          });
        },
        profile: input.profile,
        resolvedMcpServers: input.resolvedMcpServers,
        resolvedSkillCatalog: input.resolvedSkillCatalog,
        resolvedSkills: input.resolvedSkills,
        sessionId: input.sessionId,
        sessionRunId: input.sessionRunId,
        traceId: input.traceId,
      });
      runLease = preparedRunLease;
      driverInstanceId = preparedRunLease.driverInstanceId;
      const preparedDriverInstanceId = preparedRunLease.driverInstanceId;
      logInfo("session.run.prepared", {
        driverInstanceId,
        runId: input.sessionRunId,
        sandboxId,
        sessionId: input.sessionId,
        timings: preparedRunLease.timing,
        traceId: input.traceId,
      });

      await ensureSessionRunIsActive(bindings.DB, input.sessionRunId);

      const dispatchTiming = createRuntimeTimingRecorder({
        path: preparedRunLease.timing.path,
        runId: input.sessionRunId,
        sessionId: input.sessionId,
        source: "api",
        stage: "driver_turn",
        traceId: input.traceId,
      });
      await dispatchTiming.measure("dispatchDriverTurn", () =>
        executionPlane.dispatchTurn(bindings, {
          attachmentIds: input.attachmentIds,
          driverInstanceId: preparedDriverInstanceId,
          prompt: input.prompt,
          sessionRunId: input.sessionRunId,
        }),
      );
      const readyTiming = await preparedRunLease.readiness();
      await ensureSessionRunIsActive(bindings.DB, input.sessionRunId);
      prepareTimingEventPromise = appendSessionRuntimeTimingEventBestEffort({
        bindings,
        timing: readyTiming,
      });
      await prepareTimingEventPromise;
      await appendSessionRuntimeTimingEventBestEffort({
        bindings,
        timing: dispatchTiming.snapshot(),
      });

      return preparedRunLease;
    };

    const handlePreReadyRetry = async (failure: Error, retriesRemaining: number): Promise<void> => {
      await prepareTimingEventPromise;
      prepareTimingEventPromise = Promise.resolve();

      logWarn("session.run.dispatch.pre_ready_retry", {
        driverInstanceId,
        message: failure.message,
        retriesRemaining,
        runId: input.sessionRunId,
        sandboxId,
        sessionId: input.sessionId,
        traceId: input.traceId,
      });

      if (isTruthy(driverInstanceId)) {
        await cleanupDispatchedDriver(bindings, {
          driverInstanceId,
          reason: "session.run.pre-ready-retry",
          runId: input.sessionRunId,
          sessionId: input.sessionId,
          traceId: input.traceId,
        });
      }

      runLease?.release();
      runLease = null;
      driverInstanceId = null;

      // Stop retrying if the run was cancelled or failed elsewhere while
      // the dead driver was being provisioned.
      await ensureSessionRunIsActive(bindings.DB, input.sessionRunId);
    };

    runLease = await withPreReadyRetry({
      attempt: attemptPrepareAndDispatch,
      onRetry: handlePreReadyRetry,
      retryLimit: PRE_READY_DISPATCH_RETRY_LIMIT,
    });

    logInfo("session.run.driver.dispatched", {
      driverInstanceId,
      runId: input.sessionRunId,
      sandboxId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    });
  } catch (error) {
    await prepareTimingEventPromise;

    if (error instanceof SessionRunNoLongerActiveError) {
      if (isTruthy(driverInstanceId)) {
        await cleanupDispatchedDriver(bindings, {
          driverInstanceId,
          reason: `session.run.${error.status}`,
          runId: input.sessionRunId,
          sessionId: input.sessionId,
          traceId: input.traceId,
        });
      }

      logInfo("session.run.dispatch.skipped", {
        driverInstanceId,
        runId: input.sessionRunId,
        sandboxId,
        sessionId: input.sessionId,
        status: error.status,
        traceId: input.traceId,
      });

      return;
    }

    const message = describeRunError(error, "Session run provisioning failed.");
    const runError = {
      code: "runtime.provision_failed",
      details: {},
      message,
      retryable: false,
    } as const;

    if (isTruthy(driverInstanceId)) {
      await cleanupDispatchedDriver(bindings, {
        driverInstanceId,
        reason: "session.run.provision-failed",
        runId: input.sessionRunId,
        sessionId: input.sessionId,
        traceId: input.traceId,
      });
    }

    const failedRun = await updateSessionRunStatusIfActive(bindings.DB, {
      error: runError,
      runId: input.sessionRunId,
      status: "failed",
    });

    if (!failedRun) {
      const state = await getSessionRunState(bindings.DB, input.sessionRunId);

      await appendSessionRuntimeEvents({
        bindings,
        events: [
          createSessionRuntimeEvent({
            kind: "run.failed",
            payload: {
              error: {
                code: `${runError.code}.after_terminal`,
                details: {},
                message,
                retryable: false,
              },
            },
            runId: input.sessionRunId,
            sessionId: input.sessionId,
            traceId: input.traceId,
          }),
        ],
        sessionId: input.sessionId,
      });

      logWarn("session.run.provision.failed.after-terminal", {
        driverInstanceId,
        message,
        runId: input.sessionRunId,
        sessionId: input.sessionId,
        status: state?.status ?? null,
        traceId: input.traceId,
      });

      return;
    }

    await appendSessionRuntimeEvents({
      bindings,
      events: [
        createFailedSessionRunRuntimeEvent({
          run: failedRun,
          runError,
          sessionId: input.sessionId,
        }),
      ],
      sessionId: input.sessionId,
    });

    logError("session.run.provision.failed", {
      message,
      runId: input.sessionRunId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    });

    throw error;
  } finally {
    runLease?.release();
  }
}
