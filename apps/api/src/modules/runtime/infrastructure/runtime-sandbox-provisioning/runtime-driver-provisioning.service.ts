import { DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME } from "@mosoo/agent-driver/boot";
import type { EnvironmentNetworkPolicy } from "@mosoo/contracts/environment";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

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
import { createRuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import { DRIVER_HEARTBEAT_INTERVAL_MS } from "../../domain/runtime-config";
import { getRuntimeDriverSocketPath } from "../../domain/runtime-driver-routes";
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
} from "./runtime-driver-prewarm-ownership";
import { stopProvisionProcess } from "./runtime-driver-process-cleanup";
import { installRuntimeEnvironment } from "./runtime-environment-install";
import {
  sanitizeProcessId,
  toContainerReachableOrigin,
} from "./runtime-sandbox-provisioning.paths";
import type {
  ProvisionDriverInput,
  RuntimeSmokeProvision,
} from "./runtime-sandbox-provisioning.types";
import { sanitizeRuntimeVendorEnvVars } from "./runtime-vendor-env-policy";

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

export function toRuntimeProcessProxyEnv(
  bindings: RuntimeProxyBindings,
  networkPolicy: EnvironmentNetworkPolicy,
): Record<string, string> {
  // Runtime proxy bindings are host-wide ambient configuration, not
  // session-scoped policy. Injecting them into Limited would turn an allowed
  // proxy host into a tunnel around the per-session destination allowlist.
  if (networkPolicy === "limited") {
    return {};
  }

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
  env["NODE_USE_ENV_PROXY"] = "1";

  return env;
}

export async function provisionDriver(
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

  const runtimeProfile = {
    ...input.profile,
    envVars: sanitizeRuntimeVendorEnvVars(input.profile.envVars),
  };
  const driverControlPort = getDriverControlPort(driverInstanceId);
  const bootToken = await timing.measure("createBootToken", () => createOpaqueBootToken());
  const traceparent = createCurrentTraceparent();
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
  const explicitControlOrigin = env.MOSOO_RUNTIME_CONTROL_ORIGIN?.trim() || undefined;
  const containerRequestUrl = toContainerReachableOrigin(input.requestUrl, explicitControlOrigin);
  let driverGeneration: number | null = null;
  let process: RuntimeProcessHandle | null = null;

  try {
    // Claim the active binding before any remote filesystem/setup side effect.
    // The live record also prevents conversion while preparation is in flight.
    const driverRecord = await timing.measure("createDriverInstanceRecord", () =>
      createDriverInstanceRecord(env, {
        bootTokenHash: bootToken.hash,
        driverInstanceId,
        executionSessionId: input.profile.session.sandboxSessionId,
        mcpGrants: input.resolvedMcpServers.map(toDriverInstanceMcpGrantRecord),
        runtime: input.runtime,
        sandboxId,
        sandboxSessionId: input.sandboxSessionId,
      }),
    );
    if (driverRecord.status === "skipped") {
      throw new DriverPrewarmProvisionSkippedError(driverInstanceId);
    }
    const activeDriverGeneration = driverRecord.generation;
    driverGeneration = activeDriverGeneration;

    await installRuntimeEnvironment(env, {
      cloudflareSession: input.cloudflareSession,
      profile: runtimeProfile,
      sandbox: input.sandbox,
      timing,
    });

    const nativeResumeRef = await timing.measure("getNativeResumeRef", () =>
      getNativeResumeRefForRuntime(env.DB, {
        runtimeId: input.runtime,
        sessionId: input.sandboxSessionId,
      }),
    );
    const lostPrewarmOwnershipError = await getLostPrewarmOwnershipError(env, {
      bootTokenHash: bootToken.hash,
      driverInstanceId,
      generation: activeDriverGeneration,
    });

    if (lostPrewarmOwnershipError !== null) {
      throw lostPrewarmOwnershipError;
    }

    const execution = await timing.measure("buildExecutionSpec", () =>
      buildExecutionSpec(env, {
        builtInTools: input.builtInTools,
        driverGeneration: activeDriverGeneration,
        driverInstanceId,
        nativeResumeRef,
        profile: runtimeProfile,
        requestUrl: containerRequestUrl,
        resolvedMcpServers: input.resolvedMcpServers,
        resolvedSkillCatalog: input.resolvedSkillCatalog,
        resolvedSkills: input.resolvedSkills,
        sessionRunId: input.sessionRunId ?? null,
      }),
    );

    const bootPayload = createDriverBootPayload({
      bootToken: bootToken.encoded,
      controlUrl: new URL(getRuntimeDriverSocketPath(), containerRequestUrl).toString(),
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

    await timing.measure("writeBootPayload", () =>
      input.cloudflareSession.writeFile(bootPayloadPath, JSON.stringify(bootPayload)),
    );
    const startedProcess = await timing.measure("startProcess", () =>
      input.cloudflareSession.startProcess(AGENT_DRIVER_PROCESS_COMMAND, {
        autoCleanup: true,
        cwd: runtimeProfile.session.sessionOrganizationPath,
        env: {
          [DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME]: bootPayloadPath,
          ...toRuntimeProcessProxyEnv(env, runtimeProfile.network.networkPolicy),
        },
        processId,
      }),
    );
    process = startedProcess;

    await timing.measure("recordRuntimeProcessStarted", async () => {
      const recorded = await recordRuntimeProcessStarted(env, driverInstanceId, startedProcess.id, {
        expectedBootTokenHash: bootToken.hash,
        expectedGeneration: activeDriverGeneration,
      });

      if (!recorded) {
        const staleError = await getLostPrewarmOwnershipError(env, {
          bootTokenHash: bootToken.hash,
          driverInstanceId,
          generation: activeDriverGeneration,
        });

        if (staleError !== null) {
          throw staleError;
        }
      }
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
      bootTokenHash: bootToken.hash,
      driverGeneration: activeDriverGeneration,
      driverInstanceId,
      process: startedProcess,
      sandboxId,
      timing: timingSnapshot,
    };
  } catch (error) {
    const stalePrewarmError =
      error instanceof DriverPrewarmProvisionSkippedError
        ? error
        : driverGeneration === null
          ? null
          : await getLostPrewarmOwnershipError(env, {
              bootTokenHash: bootToken.hash,
              driverInstanceId,
              generation: driverGeneration,
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
