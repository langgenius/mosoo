import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";
import { DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME } from "agent-driver/boot";

import {
  createApiWideEvent,
  createCurrentTraceparent,
  createErrorLogContext,
  emitApiWideEvent,
  logError,
  logInfo,
} from "../../../../platform/cloudflare/logger";
import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../../application/runtime-diagnostic-events";
import { createRuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import { DRIVER_HEARTBEAT_INTERVAL_MS } from "../../domain/runtime-config";
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import { getDriverControlPort } from "../../domain/sandbox-layout";
import {
  createDriverInstanceRecord,
  markDriverInstanceFailedIfBootTokenMatches,
  recordRuntimeProcessStarted,
} from "../driver-instance/driver-instance-record.repository";
import { relayDriverProcessLogs } from "../driver-process-log-relay";
import { getNativeResumeRefForRuntime } from "../native-resume-ref.repository";
import { createDriverBootPayload, createOpaqueBootToken } from "../runtime-boot-token";
import { runBestEffortRuntimeCleanup } from "../runtime-cleanup";
import type { RuntimeProcessHandle } from "../sandbox-handles";
import { AGENT_DRIVER_PROCESS_COMMAND } from "./runtime-driver-artifact";
import {
  buildExecutionSpec,
  toDriverInstanceMcpGrantRecord,
} from "./runtime-driver-execution-spec.builder";
import {
  DriverPrewarmProvisionSkippedError,
  getLostPrewarmOwnershipError,
  usesInsertOnlyDriverRecord,
} from "./runtime-driver-prewarm-ownership";
import { stopProvisionProcess } from "./runtime-driver-process-cleanup";
import {
  connectDriverSocketThroughSandbox,
  waitForDriverControlPort,
} from "./runtime-driver-socket-connection";
import {
  appendRuntimeEnvironmentInstallFailed,
  createRuntimeEnvironmentInstallState,
  installRuntimeEnvironment,
  waitForRuntimeEnvironmentStartedEvents,
} from "./runtime-environment-install";
import {
  getOrganizationPath,
  sanitizeProcessId,
  toContainerReachableOrigin,
} from "./runtime-sandbox-provisioning.paths";
import type {
  ProvisionDriverInput,
  RuntimeSmokeProvision,
} from "./runtime-sandbox-provisioning.types";

export { DriverPrewarmProvisionSkippedError } from "./runtime-driver-prewarm-ownership";

const RUNTIME_NO_PROXY_DEFAULTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

type RuntimeProxyBindings = Pick<
  ApiBindings,
  | "MOSOO_RUNTIME_ALL_PROXY"
  | "MOSOO_RUNTIME_HTTP_PROXY"
  | "MOSOO_RUNTIME_HTTPS_PROXY"
  | "MOSOO_RUNTIME_NO_PROXY"
>;

function readRuntimeProxyBinding(bindings: RuntimeProxyBindings, key: keyof RuntimeProxyBindings) {
  const value = bindings[key]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function mergeRuntimeNoProxy(value: string | null): string {
  const entries = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

  for (const entry of RUNTIME_NO_PROXY_DEFAULTS) {
    entries.add(entry);
  }

  return [...entries].join(",");
}

export function toRuntimeProcessProxyEnv(bindings: RuntimeProxyBindings): Record<string, string> {
  const httpProxy = readRuntimeProxyBinding(bindings, "MOSOO_RUNTIME_HTTP_PROXY");
  const httpsProxy = readRuntimeProxyBinding(bindings, "MOSOO_RUNTIME_HTTPS_PROXY");
  const allProxy = readRuntimeProxyBinding(bindings, "MOSOO_RUNTIME_ALL_PROXY");

  if (httpProxy === null && httpsProxy === null && allProxy === null) {
    return {};
  }

  const env: Record<string, string> = {};

  if (httpProxy !== null) {
    env["HTTP_PROXY"] = httpProxy;
    env["http_proxy"] = httpProxy;
  }
  if (httpsProxy !== null) {
    env["HTTPS_PROXY"] = httpsProxy;
    env["https_proxy"] = httpsProxy;
  }
  if (allProxy !== null) {
    env["ALL_PROXY"] = allProxy;
    env["all_proxy"] = allProxy;
  }

  const noProxy = mergeRuntimeNoProxy(readRuntimeProxyBinding(bindings, "MOSOO_RUNTIME_NO_PROXY"));
  env["NO_PROXY"] = noProxy;
  env["no_proxy"] = noProxy;

  return env;
}

export async function provisionSessionDriver(
  env: ApiBindings,
  input: ProvisionDriverInput,
): Promise<RuntimeSmokeProvision> {
  return provisionDriver(env, input);
}

async function provisionDriver(
  env: ApiBindings,
  input: ProvisionDriverInput,
): Promise<RuntimeSmokeProvision> {
  const timing = createRuntimeTimingRecorder({
    path: input.sessionRunId === null ? "prewarm" : "cold",
    runId: input.sessionRunId ?? null,
    sessionId: input.sandboxSessionId,
    source: "api",
    stage: input.sessionRunId === null ? "prewarm" : "prepare_run",
    traceId: null,
  });

  const { driverInstanceId } = input;
  const processId = sanitizeProcessId(driverInstanceId);
  const sandboxId = input.profile.sandbox.id;
  const runtimeEntry = getRuntimeCatalogEntry(input.runtime);

  if (runtimeEntry === null) {
    throw new Error(`Unsupported runtime: ${input.runtime}.`);
  }

  const organizationPath = getOrganizationPath(input.profile);
  const driverControlPort = getDriverControlPort(driverInstanceId);
  const bootToken = await timing.measure("createBootToken", () => createOpaqueBootToken());
  const insertOnlyDriverRecord = usesInsertOnlyDriverRecord(input);
  const traceparent = createCurrentTraceparent();
  const runtimeBase = toRuntimeDiagnosticBaseValue({
    agentId: input.profile.configRevision.agentId,
    sessionId: input.sandboxSessionId,
    traceId: input.traceId ?? null,
  });
  const provisionEvent = createApiWideEvent("runtime.provision", {
    fields: {
      runtime: {
        driver_instance_id: driverInstanceId,
        sandbox_id: sandboxId,
      },
    },
  });

  logInfo("runtime.driver.provision.started", {
    driverInstanceId,
    sandboxId,
  });
  const environmentRevisionId = input.profile.configRevision.environmentRevisionId;
  const driverRecordPromise = timing.measure("createDriverInstanceRecord", () =>
    createDriverInstanceRecord(env, {
      bootTokenHash: bootToken.hash,
      driverInstanceId,
      mcpGrants: input.resolvedMcpServers.map(toDriverInstanceMcpGrantRecord),
      conflictStrategy: input.driverRecordConflictStrategy ?? "replace",
      runtime: input.runtime,
      sandboxId,
      sandboxSessionId: input.sandboxSessionId,
    }),
  );
  void driverRecordPromise.catch(() => undefined);

  const policy = getRuntimeKindPolicy(input.profile.kind);
  const nativeResumeRefPromise =
    policy.nativeResume.persistence === "volatile"
      ? Promise.resolve(null)
      : timing.measure("getNativeResumeRef", () =>
          getNativeResumeRefForRuntime(env.DB, {
            runtimeId: input.runtime,
            sessionId: input.sandboxSessionId,
          }),
        );
  void nativeResumeRefPromise.catch(() => undefined);

  const containerRequestUrl = toContainerReachableOrigin(input.requestUrl);
  const environmentInstall = createRuntimeEnvironmentInstallState();
  let driverGeneration: number | null = null;
  let process: RuntimeProcessHandle | null = null;
  let driverLaunchAttempted = false;

  try {
    await installRuntimeEnvironment(env, {
      cloudflareSession: input.cloudflareSession,
      environmentRevisionId,
      profile: input.profile,
      runtimeBase,
      sessionId: input.sandboxSessionId,
      state: environmentInstall,
      timing,
    });

    const [nativeResumeRef, driverRecord] = await Promise.all([
      nativeResumeRefPromise,
      driverRecordPromise,
    ]);

    if (driverRecord.status === "skipped") {
      throw new DriverPrewarmProvisionSkippedError(driverInstanceId);
    }
    const activeDriverGeneration = driverRecord.generation;
    driverGeneration = activeDriverGeneration;

    const lostPrewarmOwnershipError = await getLostPrewarmOwnershipError(env, {
      bootTokenHash: bootToken.hash,
      driverInstanceId,
      generation: activeDriverGeneration,
      insertOnly: insertOnlyDriverRecord,
    });

    if (lostPrewarmOwnershipError !== null) {
      throw lostPrewarmOwnershipError;
    }

    const execution = await timing.measure("buildExecutionSpec", () =>
      buildExecutionSpec(env, {
        driverInstanceId,
        nativeResumeRef,
        appAccessSnapshot: input.appAccessSnapshot,
        profile: input.profile,
        requestUrl: containerRequestUrl,
        resolvedMcpServers: input.resolvedMcpServers,
        resolvedSkillCatalog: input.resolvedSkillCatalog,
        resolvedSkills: input.resolvedSkills,
        sessionRunId: input.sessionRunId ?? null,
      }),
    );

    const bootPayload = createDriverBootPayload({
      bootToken: bootToken.encoded,
      driverControlPort,
      driverGeneration: activeDriverGeneration,
      driverInstanceId,
      execution,
      heartbeatIntervalMs: DRIVER_HEARTBEAT_INTERVAL_MS,
      runtime: input.runtime,
      runtimeTransport: runtimeEntry.transport,
      sandboxId,
      traceparent,
    });
    const bootPayloadPath = `${input.profile.session.homePath}/driver-boot-payload-${processId}.json`;
    const bootPayloadJson = JSON.stringify(bootPayload);

    const bootPayloadPreparedPromise = timing.measure("onBootPayloadPrepared", async () => {
      await input.onBootPayloadPrepared?.({
        bootPayload,
      });
    });
    void bootPayloadPreparedPromise.catch(() => undefined);

    driverLaunchAttempted = true;
    const launchStartedEventPromise = appendRuntimeDiagnosticEvent(env, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.driverLaunchStarted.name,
      sessionId: input.sandboxSessionId,
      value: {
        ...runtimeBase,
        driverInstanceId,
      },
    });
    void launchStartedEventPromise.catch(() => undefined);
    await timing.measure("writeBootPayload", () =>
      input.cloudflareSession.writeFile(bootPayloadPath, bootPayloadJson),
    );
    const startedProcess = await timing.measure("startProcess", () =>
      input.cloudflareSession.startProcess(AGENT_DRIVER_PROCESS_COMMAND, {
        autoCleanup: true,
        cwd: organizationPath,
        env: {
          [DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME]: bootPayloadPath,
          ...toRuntimeProcessProxyEnv(env),
        },
        processId,
      }),
    );
    process = startedProcess;

    const processRecordPromise = timing.measure("recordRuntimeProcessStarted", async () => {
      const recorded = insertOnlyDriverRecord
        ? await recordRuntimeProcessStarted(env, driverInstanceId, startedProcess.id, {
            expectedBootTokenHash: bootToken.hash,
            expectedGeneration: activeDriverGeneration,
          })
        : await recordRuntimeProcessStarted(env, driverInstanceId, startedProcess.id, {
            expectedGeneration: activeDriverGeneration,
          });

      if (!recorded) {
        const staleError = await getLostPrewarmOwnershipError(env, {
          bootTokenHash: bootToken.hash,
          driverInstanceId,
          generation: activeDriverGeneration,
          insertOnly: insertOnlyDriverRecord,
        });

        if (staleError !== null) {
          throw staleError;
        }
      }
    });
    const waitForDriverControlPortPromise = timing.measure("waitForDriverControlPort", () =>
      waitForDriverControlPort(startedProcess, driverControlPort),
    );
    void processRecordPromise.catch(() => undefined);
    void waitForDriverControlPortPromise.catch(() => undefined);
    await Promise.all([
      bootPayloadPreparedPromise,
      launchStartedEventPromise,
      processRecordPromise,
      waitForDriverControlPortPromise,
    ]);

    await timing.measure("wsConnect", async () => {
      try {
        await connectDriverSocketThroughSandbox(env, {
          bootToken: bootToken.encoded,
          driverControlPort,
          driverInstanceId,
          sandboxId,
          traceparent,
        });
      } catch (error) {
        await appendRuntimeDiagnosticEvent(env, {
          eventName: RUNTIME_DIAGNOSTIC_EVENT.transportRpcError.name,
          sessionId: input.sandboxSessionId,
          value: {
            ...runtimeBase,
            driverInstanceId,
            errorCode: "RPC_TRANSPORT_ERROR",
            reason: toRuntimeDiagnosticReason(error, "Runtime driver transport connection failed."),
          },
        });
        throw error;
      }
    });
    await appendRuntimeDiagnosticEvent(env, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.transportWsConnected.name,
      sessionId: input.sandboxSessionId,
      value: {
        ...runtimeBase,
        driverInstanceId,
        port: driverControlPort,
      },
    });

    const timingSnapshot = timing.snapshot();

    logInfo("runtime.driver.provisioned", {
      driverInstanceId,
      nativeResumeRefPresent: Boolean(nativeResumeRef),
      pid: startedProcess.pid,
      processId: startedProcess.id,
      sandboxId,
      timings: timingSnapshot,
    });

    provisionEvent.merge("runtime", {
      driver_pid: startedProcess.pid,
      process_id: startedProcess.id,
    });
    emitApiWideEvent(provisionEvent, {
      status: "success",
    });

    return {
      bootPayload,
      bootTokenHash: bootToken.hash,
      driverGeneration: activeDriverGeneration,
      driverInstanceId,
      process: startedProcess,
      sandbox: input.sandbox,
      sandboxId,
      timing: timingSnapshot,
    };
  } catch (error) {
    await Promise.all([
      driverRecordPromise.catch(() => undefined),
      waitForRuntimeEnvironmentStartedEvents(environmentInstall),
    ]);
    const caughtDriverRecord = await driverRecordPromise.catch(() => null);
    if (driverGeneration === null && caughtDriverRecord?.status === "created") {
      driverGeneration = caughtDriverRecord.generation;
    }

    const stalePrewarmError =
      error instanceof DriverPrewarmProvisionSkippedError
        ? error
        : driverGeneration === null
          ? null
          : await getLostPrewarmOwnershipError(env, {
              bootTokenHash: bootToken.hash,
              driverInstanceId,
              generation: driverGeneration,
              insertOnly: insertOnlyDriverRecord,
            });

    if (stalePrewarmError !== null) {
      await stopProvisionProcess({
        context: {
          driverInstanceId,
          sandboxId,
        },
        message: "runtime.driver.provision.skipped_process_cleanup_failed",
        process,
      });
      disposeRpcResource(process);
      logInfo("runtime.driver.provision.skipped", {
        driverInstanceId,
        sandboxId,
      });
      provisionEvent.merge("runtime", { skipped: true });
      emitApiWideEvent(provisionEvent, {
        status: "success",
      });
      throw stalePrewarmError;
    }

    await appendRuntimeEnvironmentInstallFailed(env, {
      environmentRevisionId,
      error,
      runtimeBase,
      sessionId: input.sandboxSessionId,
      state: environmentInstall,
    });

    if (driverLaunchAttempted && process === null) {
      await appendRuntimeDiagnosticEvent(env, {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.driverLaunchFailed.name,
        sessionId: input.sandboxSessionId,
        value: {
          ...runtimeBase,
          driverInstanceId,
          reason: toRuntimeDiagnosticReason(error, "Runtime driver launch failed."),
        },
      });
    }

    if (process) {
      await relayDriverProcessLogs({
        context: {
          driverInstanceId,
          sandboxId,
          sessionRunId: input.sessionRunId ?? null,
        },
        message: "runtime.driver.provision.process.logs",
        process,
      });
    }

    await runBestEffortRuntimeCleanup({
      context: {
        driverInstanceId,
        sandboxId,
      },
      message: "runtime.driver.provision.record_failed_cleanup_failed",
      task: async () => {
        const message =
          error instanceof Error ? error.message : "Runtime driver provisioning failed.";

        await markDriverInstanceFailedIfBootTokenMatches(env, {
          bootTokenHash: bootToken.hash,
          driverInstanceId,
          errorMessage: message,
          ...(driverGeneration === null ? {} : { generation: driverGeneration }),
        });
      },
    });

    await stopProvisionProcess({
      context: {
        driverInstanceId,
        sandboxId,
      },
      message: "runtime.driver.provision.process_cleanup_failed",
      process,
    });

    disposeRpcResource(process);

    logError("runtime.driver.provision.failed", {
      ...createErrorLogContext(error),
      driverInstanceId,
      sandboxId,
    });

    provisionEvent.setError(error, {
      driverInstanceId,
      sandboxId,
    });
    emitApiWideEvent(provisionEvent, {
      ...(error instanceof Error ? { error } : {}),
      status: "error",
    });

    throw error;
  }
}
