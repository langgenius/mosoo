import { sleepPromise } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, FileId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { DriverBootPayloadPreparedHandler } from "../application/execution-plane/driver-boot-payload-prepared";
import { createRuntimeTimingRecorder } from "../application/session-runs/session-runtime-timing";
import type { RuntimeTimingSnapshot } from "../application/session-runs/session-runtime-timing";
import type {
  DriverExecutionSpec,
  DriverProfileConfig,
  DriverResolvedMcpServer,
  DriverResolvedSkill,
  DriverSkillCatalogEntry,
} from "../domain/driver-snapshot";
import { DRIVER_COLD_READY_TIMEOUT_MS } from "../domain/runtime-config";
import { getDriverControlPort } from "../domain/sandbox-layout";
import { failDriverInstance } from "./driver-instance/client";
import {
  driverInstanceRecordMatchesBootToken,
  getReusableDriverInstanceRecord,
  markDriverInstanceFailedIfBootTokenMatches,
} from "./driver-instance/driver-instance-record.repository";
import { currentTimestampPlus } from "./driver-instance/driver-instance-support";
import {
  appendDriverSocketReconnectFailedIfNeeded,
  appendDriverSocketReconnectSucceededIfNeeded,
  DRIVER_SOCKET_MISSING_MESSAGE,
  startDriverSocketReconnectAttempt,
} from "./driver-session-reconnect";
import type { DriverSocketReconnectAttempt } from "./driver-session-reconnect";
import { disposeDriverProcess, waitForDriverReady } from "./driver-session-startup";
import type { DriverRuntimeStartupEventContext } from "./driver-session-startup";
import { driverReadySocketIsConnected, getDriverUsage } from "./driver-session-state";
import {
  DriverPrewarmProvisionSkippedError,
  provisionSessionDriver,
} from "./runtime-sandbox-provisioner";
import { stopProvisionProcess } from "./runtime-sandbox-provisioning/runtime-driver-process-cleanup";
import type { RuntimeRunLeaseTransitionOutcome } from "./runtime-subject-lifecycle/runtime-run-lease-store";
import { createRuntimeSubjectLifecycleService } from "./runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import type {
  ExecutionSessionHandle,
  RuntimeProcessHandle,
  SandboxHandle,
} from "./sandbox-handles";
import { createRuntimeCommandRecord } from "./session-runs/runtime-command-store.repository";

const DRIVER_SESSION_POLL_MS = 200;

async function allocateDriverInstanceId(
  database: D1Database,
  input: {
    sandboxId: SandboxId;
    sandboxSessionId: SessionId;
  },
): Promise<DriverInstanceId> {
  const reusable = await getReusableDriverInstanceRecord(database, input);
  return reusable?.id ?? createPlatformId();
}

function isRuntimeRunLeaseAcquireSuccess(outcome: RuntimeRunLeaseTransitionOutcome): boolean {
  return (
    outcome.transition === "acquire" &&
    (outcome.status === "applied" || outcome.status === "duplicate")
  );
}

function isRetryableRuntimeRunLeaseAcquireOutcome(
  outcome: RuntimeRunLeaseTransitionOutcome,
): boolean {
  if (outcome.transition !== "acquire") {
    return false;
  }

  if (outcome.status === "stale") {
    return true;
  }

  return (
    outcome.status === "rejected" &&
    (outcome.reason === "driver_already_leased" || outcome.reason === "run_already_leased")
  );
}

async function waitForRetryableRunLeaseOutcome(
  outcome: RuntimeRunLeaseTransitionOutcome,
): Promise<void> {
  if (isRetryableRuntimeRunLeaseAcquireOutcome(outcome)) {
    await sleepPromise(DRIVER_SESSION_POLL_MS);
    return;
  }

  const reason = "reason" in outcome ? outcome.reason : outcome.status;
  throw new Error(`Runtime run lease acquire failed: ${reason}.`);
}

async function releasePreparedRunLeaseAfterFailure(input: {
  driverInstanceId: DriverInstanceId;
  runtimeSubjectLifecycle: ReturnType<typeof createRuntimeSubjectLifecycleService>;
  sessionId: SessionId;
  sessionRunId: SessionRunId;
  traceId: string;
}): Promise<void> {
  try {
    const released = await input.runtimeSubjectLifecycle.releaseRunLease({
      driverInstanceId: input.driverInstanceId,
      expectedSessionRunId: input.sessionRunId,
    });

    if (!released) {
      logWarn("session.run.prepare.release_skipped", {
        driverInstanceId: input.driverInstanceId,
        runId: input.sessionRunId,
        sessionId: input.sessionId,
        traceId: input.traceId,
      });
    }
  } catch (error) {
    logWarn("session.run.prepare.release_failed", {
      driverInstanceId: input.driverInstanceId,
      message: error instanceof Error ? error.message : "Runtime run lease release failed.",
      runId: input.sessionRunId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    });
  }
}

export async function ensureDriverSessionReady(
  bindings: ApiBindings,
  requestUrl: string,
  input: {
    builtInTools: DriverExecutionSpec["builtInTools"];
    cloudflareSession: ExecutionSessionHandle;
    profile: DriverProfileConfig;
    resolvedMcpServers: DriverResolvedMcpServer[];
    resolvedSkillCatalog: DriverSkillCatalogEntry[];
    resolvedSkills: Omit<DriverResolvedSkill, "downloadUrl">[];
    sandbox: SandboxHandle;
    sandboxSessionId: SessionId;
    sessionId: SessionId;
    sessionRunId: SessionRunId;
    traceId: string;
    onBootPayloadPrepared?: DriverBootPayloadPreparedHandler;
  },
): Promise<{
  driverInstanceId: DriverInstanceId;
  readiness(): Promise<RuntimeTimingSnapshot>;
  timing: RuntimeTimingSnapshot;
}> {
  let driverInstanceId = await allocateDriverInstanceId(bindings.DB, {
    sandboxId: input.profile.sandbox.id,
    sandboxSessionId: input.sandboxSessionId,
  });
  const timing = createRuntimeTimingRecorder({
    runId: input.sessionRunId,
    sessionId: input.sessionId,
    source: "api",
    stage: "prepare_run",
    traceId: input.traceId,
  });
  const runtimeSubjectLifecycle = createRuntimeSubjectLifecycleService(bindings);
  let reconnectAttempt: DriverSocketReconnectAttempt | null = null;

  while (true) {
    const eventContext: DriverRuntimeStartupEventContext = {
      agentId: input.profile.configRevision.agentId,
      driverControlPort: getDriverControlPort(driverInstanceId),
      driverInstanceId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    };
    const usage = await timing.measure("driver.getUsage", () =>
      getDriverUsage(bindings.DB, driverInstanceId),
    );
    const usageSessionRunId = usage?.sessionRunId ?? null;

    if (usageSessionRunId !== null && usageSessionRunId !== input.sessionRunId) {
      await sleepPromise(DRIVER_SESSION_POLL_MS);
      continue;
    }

    if (usage && (usage.status === "failed" || usage.status === "stopped")) {
      driverInstanceId = createPlatformId();
      reconnectAttempt = null;
      continue;
    }

    if (usage?.status === "ready") {
      if (
        !(await timing.measure("driver.readySocketCheck", () =>
          driverReadySocketIsConnected(bindings, driverInstanceId),
        ))
      ) {
        reconnectAttempt = await startDriverSocketReconnectAttempt(bindings, {
          currentAttempt: reconnectAttempt,
          eventContext,
        });

        try {
          await failDriverInstance(bindings, driverInstanceId, DRIVER_SOCKET_MISSING_MESSAGE);
          await runtimeSubjectLifecycle.releaseRunLease({
            driverInstanceId,
            expectedSessionRunId: input.sessionRunId,
          });
        } catch (error) {
          await appendDriverSocketReconnectFailedIfNeeded(bindings, {
            attempt: reconnectAttempt,
            error,
            eventContext,
          });
          throw error;
        }

        continue;
      }

      const runLeaseOutcome = await timing.measure("driver.bindRun", () =>
        runtimeSubjectLifecycle.acquireRunLease({
          driverInstanceId,
          runtimeSubjectId: input.profile.sandbox.id,
          sessionId: input.sessionId,
          sessionRunId: input.sessionRunId,
        }),
      );

      if (!isRuntimeRunLeaseAcquireSuccess(runLeaseOutcome)) {
        await waitForRetryableRunLeaseOutcome(runLeaseOutcome);
        continue;
      }

      await appendDriverSocketReconnectSucceededIfNeeded(bindings, {
        attempt: reconnectAttempt,
        eventContext,
      });

      const readyTiming = timing.snapshot({ path: "warm" });

      return {
        driverInstanceId,
        readiness: async () => readyTiming,
        timing: readyTiming,
      };
    }

    if (usage && (usage.status === "provisioning" || usage.status === "connecting")) {
      const runLeaseOutcome = await timing.measure("driver.bindProvisioningRun", () =>
        runtimeSubjectLifecycle.acquireRunLease({
          driverInstanceId,
          runtimeSubjectId: input.profile.sandbox.id,
          sessionId: input.sessionId,
          sessionRunId: input.sessionRunId,
        }),
      );

      if (!isRuntimeRunLeaseAcquireSuccess(runLeaseOutcome)) {
        await waitForRetryableRunLeaseOutcome(runLeaseOutcome);
        continue;
      }

      return {
        driverInstanceId,
        readiness: async () => {
          try {
            await timing.measure("driver.waitProvisioningReady", () =>
              waitForDriverReady(bindings, {
                driverInstanceId,
                eventContext,
                logContext: {
                  driverInstanceId,
                  sandboxId: input.profile.sandbox.id,
                  sessionId: input.sessionId,
                  sessionRunId: input.sessionRunId,
                  traceId: input.traceId,
                },
              }),
            );
          } catch (error) {
            await appendDriverSocketReconnectFailedIfNeeded(bindings, {
              attempt: reconnectAttempt,
              error,
              eventContext,
            });
            await releasePreparedRunLeaseAfterFailure({
              driverInstanceId,
              runtimeSubjectLifecycle,
              sessionId: input.sessionId,
              sessionRunId: input.sessionRunId,
              traceId: input.traceId,
            });
            throw error;
          }
          await appendDriverSocketReconnectSucceededIfNeeded(bindings, {
            attempt: reconnectAttempt,
            eventContext,
          });

          return timing.snapshot({ path: "prewarm" });
        },
        timing: timing.snapshot({ path: "prewarm" }),
      };
    }

    const provisionInput = {
      builtInTools: input.builtInTools,
      cloudflareSession: input.cloudflareSession,
      driverRecordConflictStrategy: "insert-only" as const,
      driverInstanceId,
      profile: input.profile,
      requestUrl,
      resolvedMcpServers: input.resolvedMcpServers,
      resolvedSkillCatalog: input.resolvedSkillCatalog,
      resolvedSkills: input.resolvedSkills,
      runtime: input.profile.runtimeId,
      sandbox: input.sandbox,
      sandboxSessionId: input.sandboxSessionId,
      sessionRunId: input.sessionRunId,
      traceId: input.traceId,
    };
    const { onBootPayloadPrepared } = input;
    let provisionProcess: RuntimeProcessHandle | null = null;
    let reconnectFailureEventContext = eventContext;

    try {
      const provision = await timing.measure("driver.provision", () =>
        provisionSessionDriver(
          bindings,
          onBootPayloadPrepared
            ? {
                ...provisionInput,
                onBootPayloadPrepared,
              }
            : provisionInput,
        ),
      );
      for (const phase of provision.timing.phases) {
        timing.addPhase(`driver.provision.${phase.name}`, phase.durationMs);
      }
      provisionProcess = provision.process;
      const provisionEventContext = {
        ...eventContext,
        driverInstanceId: provision.driverInstanceId,
      };
      reconnectFailureEventContext = provisionEventContext;

      const provisioningRunLeaseOutcome = await timing.measure("driver.bindProvisioningRun", () =>
        runtimeSubjectLifecycle.acquireRunLease({
          driverInstanceId: provision.driverInstanceId,
          runtimeSubjectId: input.profile.sandbox.id,
          sessionId: input.sessionId,
          sessionRunId: input.sessionRunId,
        }),
      );

      if (!isRuntimeRunLeaseAcquireSuccess(provisioningRunLeaseOutcome)) {
        await waitForRetryableRunLeaseOutcome(provisioningRunLeaseOutcome);
        continue;
      }

      const readyProcess = provision.process;
      provisionProcess = null;

      return {
        driverInstanceId: provision.driverInstanceId,
        readiness: async () => {
          try {
            await timing.measure("driver.waitForReady", () =>
              waitForDriverReady(bindings, {
                driverInstanceId: provision.driverInstanceId,
                eventContext: provisionEventContext,
                logContext: {
                  driverInstanceId: provision.driverInstanceId,
                  sandboxId: provision.sandboxId,
                  sessionId: input.sessionId,
                  sessionRunId: input.sessionRunId,
                  traceId: input.traceId,
                },
                process: readyProcess,
              }),
            );
          } catch (error) {
            await releasePreparedRunLeaseAfterFailure({
              driverInstanceId: provision.driverInstanceId,
              runtimeSubjectLifecycle,
              sessionId: input.sessionId,
              sessionRunId: input.sessionRunId,
              traceId: input.traceId,
            });
            await appendDriverSocketReconnectFailedIfNeeded(bindings, {
              attempt: reconnectAttempt,
              error,
              eventContext: provisionEventContext,
            });
            throw error;
          } finally {
            disposeDriverProcess(readyProcess);
          }

          await appendDriverSocketReconnectSucceededIfNeeded(bindings, {
            attempt: reconnectAttempt,
            eventContext: provisionEventContext,
          });

          return timing.snapshot({ path: "cold" });
        },
        timing: timing.snapshot({ path: "cold" }),
      };
    } catch (error) {
      if (error instanceof DriverPrewarmProvisionSkippedError) {
        await stopProvisionProcess({
          context: {
            driverInstanceId,
            sandboxId: input.profile.sandbox.id,
            sessionId: input.sessionId,
            sessionRunId: input.sessionRunId,
          },
          message: "runtime.driver.provision.skipped_process_cleanup_failed",
          process: provisionProcess,
        });
        driverInstanceId = await allocateDriverInstanceId(bindings.DB, {
          sandboxId: input.profile.sandbox.id,
          sandboxSessionId: input.sandboxSessionId,
        });
        reconnectAttempt = null;
        continue;
      }
      await releasePreparedRunLeaseAfterFailure({
        driverInstanceId,
        runtimeSubjectLifecycle,
        sessionId: input.sessionId,
        sessionRunId: input.sessionRunId,
        traceId: input.traceId,
      });
      await appendDriverSocketReconnectFailedIfNeeded(bindings, {
        attempt: reconnectAttempt,
        error,
        eventContext: reconnectFailureEventContext,
      });
      throw error;
    } finally {
      disposeDriverProcess(provisionProcess);
    }
  }
}

export async function prewarmDriverSession(
  bindings: ApiBindings,
  requestUrl: string,
  input: {
    builtInTools: DriverExecutionSpec["builtInTools"];
    cloudflareSession: ExecutionSessionHandle;
    profile: DriverProfileConfig;
    resolvedMcpServers: DriverResolvedMcpServer[];
    resolvedSkillCatalog: DriverSkillCatalogEntry[];
    resolvedSkills: Omit<DriverResolvedSkill, "downloadUrl">[];
    sandbox: SandboxHandle;
    sandboxSessionId: SessionId;
    sessionId: SessionId;
  },
): Promise<{
  driverInstanceId: DriverInstanceId;
  timing: RuntimeTimingSnapshot;
} | null> {
  let driverInstanceId = await allocateDriverInstanceId(bindings.DB, {
    sandboxId: input.profile.sandbox.id,
    sandboxSessionId: input.sandboxSessionId,
  });
  const timing = createRuntimeTimingRecorder({
    path: "prewarm",
    runId: null,
    sessionId: input.sessionId,
    source: "api",
    stage: "prewarm",
    traceId: null,
  });

  while (true) {
    const eventContext: DriverRuntimeStartupEventContext = {
      agentId: input.profile.configRevision.agentId,
      driverControlPort: getDriverControlPort(driverInstanceId),
      driverInstanceId,
      sessionId: input.sessionId,
      traceId: null,
    };
    const usage = await timing.measure("driver.getUsage", () =>
      getDriverUsage(bindings.DB, driverInstanceId),
    );

    if ((usage?.sessionRunId ?? null) !== null) {
      return null;
    }

    if (usage && (usage.status === "failed" || usage.status === "stopped")) {
      driverInstanceId = createPlatformId();
      continue;
    }

    if (usage?.status === "ready") {
      const socketConnected = await timing.measure("driver.readySocketCheck", () =>
        driverReadySocketIsConnected(bindings, driverInstanceId),
      );

      if (socketConnected) {
        return { driverInstanceId, timing: timing.snapshot({ path: "warm" }) };
      }

      await failDriverInstance(bindings, driverInstanceId, DRIVER_SOCKET_MISSING_MESSAGE);
      continue;
    }

    if (usage && (usage.status === "provisioning" || usage.status === "connecting")) {
      await timing.measure("driver.waitProvisioningReady", () =>
        waitForDriverReady(bindings, {
          driverInstanceId,
          eventContext,
          logContext: {
            driverInstanceId,
            sandboxId: input.profile.sandbox.id,
            sessionId: input.sessionId,
            sessionRunId: null,
          },
        }),
      );

      return { driverInstanceId, timing: timing.snapshot({ path: "prewarm" }) };
    }

    const provisionInput = {
      builtInTools: input.builtInTools,
      cloudflareSession: input.cloudflareSession,
      driverRecordConflictStrategy: "insert-only" as const,
      driverInstanceId,
      profile: input.profile,
      requestUrl,
      resolvedMcpServers: input.resolvedMcpServers,
      resolvedSkillCatalog: input.resolvedSkillCatalog,
      resolvedSkills: input.resolvedSkills,
      runtime: input.profile.runtimeId,
      sandbox: input.sandbox,
      sandboxSessionId: input.sandboxSessionId,
      sessionRunId: null,
      traceId: null,
    };
    let provisionProcess: RuntimeProcessHandle | null = null;

    try {
      const provision = await timing.measure("driver.provision", () =>
        provisionSessionDriver(bindings, provisionInput),
      );
      for (const phase of provision.timing.phases) {
        timing.addPhase(`driver.provision.${phase.name}`, phase.durationMs);
      }
      provisionProcess = provision.process;

      await timing.measure("driver.waitForReady", () =>
        waitForDriverReady(bindings, {
          driverInstanceId: provision.driverInstanceId,
          eventContext: {
            ...eventContext,
            driverInstanceId: provision.driverInstanceId,
          },
          getStaleStartupError: async () => {
            const stillOwnsRecord = await driverInstanceRecordMatchesBootToken(bindings.DB, {
              bootTokenHash: provision.bootTokenHash,
              driverInstanceId: provision.driverInstanceId,
              generation: provision.driverGeneration,
            });

            return stillOwnsRecord
              ? null
              : new DriverPrewarmProvisionSkippedError(provision.driverInstanceId);
          },
          logContext: {
            driverInstanceId: provision.driverInstanceId,
            sandboxId: provision.sandboxId,
            sessionId: input.sessionId,
            sessionRunId: null,
          },
          markStartupFailed: async (message) => {
            await markDriverInstanceFailedIfBootTokenMatches(bindings, {
              bootTokenHash: provision.bootTokenHash,
              driverInstanceId: provision.driverInstanceId,
              errorMessage: message,
              generation: provision.driverGeneration,
            });
          },
          process: provision.process,
        }),
      );

      const stillOwnsReadyRecord = await driverInstanceRecordMatchesBootToken(bindings.DB, {
        bootTokenHash: provision.bootTokenHash,
        driverInstanceId: provision.driverInstanceId,
        generation: provision.driverGeneration,
      });

      if (!stillOwnsReadyRecord) {
        throw new DriverPrewarmProvisionSkippedError(provision.driverInstanceId);
      }

      return {
        driverInstanceId: provision.driverInstanceId,
        timing: timing.snapshot({ path: "prewarm" }),
      };
    } catch (error) {
      if (error instanceof DriverPrewarmProvisionSkippedError) {
        await stopProvisionProcess({
          context: {
            driverInstanceId,
            sandboxId: input.profile.sandbox.id,
            sessionId: input.sessionId,
            sessionRunId: null,
          },
          message: "runtime.driver.prewarm.skipped_process_cleanup_failed",
          process: provisionProcess,
        });

        return null;
      }

      throw error;
    } finally {
      disposeDriverProcess(provisionProcess);
    }
  }
}

export async function dispatchDriverTurn(
  bindings: ApiBindings,
  input: {
    attachmentIds: FileId[];
    driverInstanceId: DriverInstanceId;
    prompt: string;
    sessionRunId: SessionRunId;
  },
): Promise<void> {
  await createRuntimeCommandRecord(bindings.DB, {
    command: {
      commandId: createPlatformId(),
      input: {
        ...(input.attachmentIds.length > 0 ? { attachmentIds: input.attachmentIds } : {}),
        text: input.prompt,
      },
      kind: "input.start",
      requestId: createPlatformId(),
      runId: input.sessionRunId,
    },
    driverInstanceId: input.driverInstanceId,
    expiresAt: currentTimestampPlus(DRIVER_COLD_READY_TIMEOUT_MS),
  });
}

export { stopDriverSession } from "./driver-session-stop.service";
