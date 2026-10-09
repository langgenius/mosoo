import { sleepPromise } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, FileId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";

import { logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
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
import { failDriverInstance, getDriverInstanceSnapshot } from "./driver-instance/client";
import {
  driverInstanceRecordMatchesBootToken,
  getReusableDriverInstanceRecord,
  markDriverInstanceFailedIfBootTokenMatches,
} from "./driver-instance/driver-instance-record.repository";
import { disposeDriverProcess, waitForDriverReady } from "./driver-session-startup";
import { getDriverUsage } from "./driver-session-state";
import { DRIVER_SOCKET_MISSING_MESSAGE } from "./driver-session-stop-errors";
import { DriverPrewarmProvisionSkippedError } from "./runtime-sandbox-provisioning/runtime-driver-prewarm-ownership";
import { stopProvisionProcess } from "./runtime-sandbox-provisioning/runtime-driver-process-cleanup";
import { provisionDriver } from "./runtime-sandbox-provisioning/runtime-driver-provisioning.service";
import {
  acquireRuntimeRunLease,
  releaseRuntimeRunLease,
} from "./runtime-subject-lifecycle/runtime-run-lease-store";
import type { RuntimeRunLeaseAcquireOutcome } from "./runtime-subject-lifecycle/runtime-run-lease-store";
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
    sessionId: SessionId;
  },
): Promise<DriverInstanceId> {
  const reusable = await getReusableDriverInstanceRecord(database, {
    sandboxId: input.sandboxId,
    sandboxSessionId: input.sessionId,
  });
  return reusable?.id ?? createPlatformId();
}

async function waitForRetryableRunLeaseOutcome(
  outcome: Extract<RuntimeRunLeaseAcquireOutcome, { ok: false }>,
): Promise<void> {
  if (outcome.retryable) {
    await sleepPromise(DRIVER_SESSION_POLL_MS);
    return;
  }

  throw new Error(`Runtime run lease acquire failed: ${outcome.reason}.`);
}

async function releasePreparedRunLeaseAfterFailure(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    sessionId: SessionId;
    sessionRunId: SessionRunId;
    traceId: string;
  },
): Promise<void> {
  try {
    const released = await releaseRuntimeRunLease(database, {
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
    sessionId: SessionId;
    sessionRunId: SessionRunId;
    traceId: string;
  },
): Promise<{
  driverInstanceId: DriverInstanceId;
  readiness(): Promise<RuntimeTimingSnapshot>;
  timing: RuntimeTimingSnapshot;
}> {
  const sandboxId = input.profile.sandbox.id;
  let driverInstanceId = await allocateDriverInstanceId(bindings.DB, {
    sandboxId,
    sessionId: input.sessionId,
  });
  const timing = createRuntimeTimingRecorder({
    runId: input.sessionRunId,
    sessionId: input.sessionId,
    source: "api",
    stage: "prepare_run",
    traceId: input.traceId,
  });
  const leaseInput = {
    runtimeSubjectId: sandboxId,
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
  };
  const releaseInput = {
    sessionId: input.sessionId,
    sessionRunId: input.sessionRunId,
    traceId: input.traceId,
  };

  while (true) {
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
      continue;
    }

    if (usage?.status === "ready") {
      const snapshot = await timing.measure("driver.readySocketCheck", () =>
        getDriverInstanceSnapshot(bindings, driverInstanceId),
      );

      if (!snapshot.driverSocketConnected) {
        logWarn("runtime.driver.socket_missing", {
          driverInstanceId,
          runId: input.sessionRunId,
          sessionId: input.sessionId,
          traceId: input.traceId,
        });
        await failDriverInstance(bindings, driverInstanceId, DRIVER_SOCKET_MISSING_MESSAGE);
        await releaseRuntimeRunLease(bindings.DB, {
          driverInstanceId,
          expectedSessionRunId: input.sessionRunId,
        });
        continue;
      }

      const runLeaseOutcome = await timing.measure("driver.bindRun", () =>
        acquireRuntimeRunLease(bindings.DB, { ...leaseInput, driverInstanceId }),
      );

      if (!runLeaseOutcome.ok) {
        await waitForRetryableRunLeaseOutcome(runLeaseOutcome);
        continue;
      }

      const readyTiming = timing.snapshot({ path: "warm" });

      return {
        driverInstanceId,
        readiness: async () => readyTiming,
        timing: readyTiming,
      };
    }

    if (usage && (usage.status === "provisioning" || usage.status === "connecting")) {
      const runLeaseOutcome = await timing.measure("driver.bindProvisioningRun", () =>
        acquireRuntimeRunLease(bindings.DB, { ...leaseInput, driverInstanceId }),
      );

      if (!runLeaseOutcome.ok) {
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
                logContext: {
                  driverInstanceId,
                  sandboxId,
                  sessionId: input.sessionId,
                  sessionRunId: input.sessionRunId,
                  traceId: input.traceId,
                },
              }),
            );
          } catch (error) {
            await releasePreparedRunLeaseAfterFailure(bindings.DB, {
              ...releaseInput,
              driverInstanceId,
            });
            throw error;
          }

          return timing.snapshot({ path: "prewarm" });
        },
        timing: timing.snapshot({ path: "prewarm" }),
      };
    }

    let provisionProcess: RuntimeProcessHandle | null = null;

    try {
      const provision = await timing.measure("driver.provision", () =>
        provisionDriver(bindings, {
          builtInTools: input.builtInTools,
          cloudflareSession: input.cloudflareSession,
          driverInstanceId,
          profile: input.profile,
          requestUrl,
          resolvedMcpServers: input.resolvedMcpServers,
          resolvedSkillCatalog: input.resolvedSkillCatalog,
          resolvedSkills: input.resolvedSkills,
          runtime: input.profile.runtimeId,
          sandbox: input.sandbox,
          sandboxSessionId: input.sessionId,
          sessionRunId: input.sessionRunId,
        }),
      );
      for (const phase of provision.timing.phases) {
        timing.addPhase(`driver.provision.${phase.name}`, phase.durationMs);
      }
      provisionProcess = provision.process;

      const provisioningRunLeaseOutcome = await timing.measure("driver.bindProvisioningRun", () =>
        acquireRuntimeRunLease(bindings.DB, {
          ...leaseInput,
          driverInstanceId: provision.driverInstanceId,
        }),
      );

      if (!provisioningRunLeaseOutcome.ok) {
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
            await releasePreparedRunLeaseAfterFailure(bindings.DB, {
              ...releaseInput,
              driverInstanceId: provision.driverInstanceId,
            });
            throw error;
          } finally {
            disposeDriverProcess(readyProcess);
          }

          return timing.snapshot({ path: "cold" });
        },
        timing: timing.snapshot({ path: "cold" }),
      };
    } catch (error) {
      if (error instanceof DriverPrewarmProvisionSkippedError) {
        await stopProvisionProcess({
          context: {
            driverInstanceId,
            sandboxId,
            sessionId: input.sessionId,
            sessionRunId: input.sessionRunId,
          },
          message: "runtime.driver.provision.skipped_process_cleanup_failed",
          process: provisionProcess,
        });
        driverInstanceId = await allocateDriverInstanceId(bindings.DB, {
          sandboxId,
          sessionId: input.sessionId,
        });
        continue;
      }
      await releasePreparedRunLeaseAfterFailure(bindings.DB, {
        ...releaseInput,
        driverInstanceId,
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
    sessionId: SessionId;
  },
): Promise<{
  driverInstanceId: DriverInstanceId;
  timing: RuntimeTimingSnapshot;
} | null> {
  const sandboxId = input.profile.sandbox.id;
  let driverInstanceId = await allocateDriverInstanceId(bindings.DB, {
    sandboxId,
    sessionId: input.sessionId,
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
      const snapshot = await timing.measure("driver.readySocketCheck", () =>
        getDriverInstanceSnapshot(bindings, driverInstanceId),
      );

      if (snapshot.driverSocketConnected) {
        return { driverInstanceId, timing: timing.snapshot({ path: "warm" }) };
      }

      await failDriverInstance(bindings, driverInstanceId, DRIVER_SOCKET_MISSING_MESSAGE);
      continue;
    }

    if (usage && (usage.status === "provisioning" || usage.status === "connecting")) {
      await timing.measure("driver.waitProvisioningReady", () =>
        waitForDriverReady(bindings, {
          driverInstanceId,
          logContext: {
            driverInstanceId,
            sandboxId,
            sessionId: input.sessionId,
            sessionRunId: null,
          },
        }),
      );

      return { driverInstanceId, timing: timing.snapshot({ path: "prewarm" }) };
    }

    let provisionProcess: RuntimeProcessHandle | null = null;

    try {
      const provision = await timing.measure("driver.provision", () =>
        provisionDriver(bindings, {
          builtInTools: input.builtInTools,
          cloudflareSession: input.cloudflareSession,
          driverInstanceId,
          profile: input.profile,
          requestUrl,
          resolvedMcpServers: input.resolvedMcpServers,
          resolvedSkillCatalog: input.resolvedSkillCatalog,
          resolvedSkills: input.resolvedSkills,
          runtime: input.profile.runtimeId,
          sandbox: input.sandbox,
          sandboxSessionId: input.sessionId,
          sessionRunId: null,
        }),
      );
      for (const phase of provision.timing.phases) {
        timing.addPhase(`driver.provision.${phase.name}`, phase.durationMs);
      }
      provisionProcess = provision.process;

      await timing.measure("driver.waitForReady", () =>
        waitForDriverReady(bindings, {
          driverInstanceId: provision.driverInstanceId,
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
            sandboxId,
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
    expiresAt: Date.now() + DRIVER_COLD_READY_TIMEOUT_MS,
  });
}
