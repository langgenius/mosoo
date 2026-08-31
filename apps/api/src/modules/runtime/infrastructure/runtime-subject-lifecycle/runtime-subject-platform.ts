import {
  SANDBOX_CACHE_PATH,
  SANDBOX_MEMORY_PATH,
  SANDBOX_SESSION_ROOT,
} from "@mosoo/agent-driver/paths";
import { discardPromiseResult } from "@mosoo/effects";

import {
  withDisposedRpcResource,
  withDisposedRpcResult,
} from "../../../../platform/cloudflare/rpc-disposal";
import { requireCloudflareSandboxBinding } from "../../../../platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { quoteShellArg } from "../../../../shared/shell";
import type { RuntimeStateClearRule } from "../../domain/runtime-kind-policy";
import type { SandboxNetworkConstraints } from "../../domain/sandbox-network-constraints";
import { withRuntimeProvisionTimeout } from "../runtime-provision-timeout";
import { decodeSandboxBackupIdForPlatform } from "../sandbox-backup-id";
import { toRuntimeSubjectIncarnationHandle, toSandboxHandle } from "../sandbox-handles";
import type { SandboxHandle } from "../sandbox-handles";
import type { ReadyRuntimeSubjectBackupRecord } from "./runtime-subject-store";

export function getRuntimeSubjectKeepAliveHandle(
  bindings: ApiBindings,
  runtimeSubjectId: string,
  incarnation: number,
): Promise<SandboxHandle> {
  const physicalId =
    incarnation === 0 ? runtimeSubjectId : `${runtimeSubjectId}-i${incarnation.toString(36)}`;
  if (bindings.runtimeSubjectHandleFactory) {
    return Promise.resolve(toSandboxHandle(bindings.runtimeSubjectHandleFactory(physicalId)));
  }

  return getCloudflareRuntimeSubjectKeepAliveHandle(bindings, physicalId);
}

function getUnversionedSandboxHandle(
  bindings: ApiBindings,
  sandboxId: string,
): Promise<SandboxHandle> {
  if (bindings.runtimeSubjectHandleFactory) {
    return Promise.resolve(toSandboxHandle(bindings.runtimeSubjectHandleFactory(sandboxId)));
  }
  return getCloudflareRuntimeSubjectKeepAliveHandle(bindings, sandboxId);
}

export function getEphemeralUnversionedSandboxHandle(
  bindings: ApiBindings,
  sandboxId: string,
  sleepAfter: string | number,
): Promise<SandboxHandle> {
  if (bindings.runtimeSubjectHandleFactory) {
    return Promise.resolve(toSandboxHandle(bindings.runtimeSubjectHandleFactory(sandboxId)));
  }
  return getCloudflareEphemeralSandboxHandle(bindings, sandboxId, sleepAfter);
}

export function createEphemeralSandboxOptions(sleepAfter: string | number): {
  readonly keepAlive: false;
  readonly normalizeId: true;
  readonly sleepAfter: string | number;
} {
  return { keepAlive: false, normalizeId: true, sleepAfter };
}

async function getCloudflareRuntimeSubjectKeepAliveHandle(
  bindings: ApiBindings,
  runtimeSubjectId: string,
): Promise<SandboxHandle> {
  const { getSandbox } = await import("@cloudflare/sandbox");
  const sandbox = getSandbox(requireCloudflareSandboxBinding(bindings), runtimeSubjectId, {
    keepAlive: true,
    normalizeId: true,
  });
  return toSandboxHandle(sandbox);
}

async function getCloudflareEphemeralSandboxHandle(
  bindings: ApiBindings,
  sandboxId: string,
  sleepAfter: string | number,
): Promise<SandboxHandle> {
  const { getSandbox } = await import("@cloudflare/sandbox");
  return toSandboxHandle(
    getSandbox(
      requireCloudflareSandboxBinding(bindings),
      sandboxId,
      createEphemeralSandboxOptions(sleepAfter),
    ),
  );
}

/**
 * Pushes the environment egress policy into the sandbox Durable Object. Must
 * run before any container-starting call (mkdir/exec/session create): the
 * internet switch only takes effect at container start, and a limited policy
 * must fail closed here rather than let the container come up unrestricted.
 */
export async function configureRuntimeSubjectNetwork(
  subject: SandboxHandle,
  constraints: SandboxNetworkConstraints,
): Promise<void> {
  await withRuntimeProvisionTimeout(
    subject.configureNetworkConstraints(constraints),
    "Runtime subject network configure",
  );
}

export async function prepareRuntimeSubjectFilesystem(subject: SandboxHandle): Promise<void> {
  // Guard these container RPCs with the provision timeout. On local Apple Silicon container
  // reactivation the SDK's
  // port-readiness wait can stall ~120s; without a timeout the run wedges in `booting`
  // indefinitely until the next message reconciles it as `runtime.inactive`. Failing fast
  // surfaces a retryable `runtime.provision_failed` instead.
  // The four RPCs are mutually independent: setKeepAlive configures the
  // container lifetime while the mkdirs assert platform roots. Awaiting all of
  // them keeps the explicit completion barrier for each call while removing
  // the serial keep-alive wait from the first-token critical path.
  await withRuntimeProvisionTimeout(
    Promise.all([
      subject.setKeepAlive(true),
      subject.mkdir(SANDBOX_CACHE_PATH, { recursive: true }),
      subject.mkdir(SANDBOX_MEMORY_PATH, { recursive: true }),
      subject.mkdir(SANDBOX_SESSION_ROOT, { recursive: true }),
    ]).then(() => undefined),
    "Runtime subject filesystem prepare",
  );
}

export async function activateRuntimeSubjectIncarnation(
  subject: SandboxHandle,
  incarnation: number,
  networkConstraintsHash: string,
): Promise<void> {
  await withRuntimeProvisionTimeout(
    toRuntimeSubjectIncarnationHandle(subject).activateRuntimeSubjectIncarnation(
      incarnation,
      networkConstraintsHash,
    ),
    `Runtime subject incarnation ${incarnation} activation`,
  );
}

export async function inspectRuntimeSubjectIncarnation(
  subject: SandboxHandle,
  incarnation: number,
  networkConstraintsHash: string,
): Promise<{ kind: "healthy" | "missing" | "retired" | "stale" | "unknown" }> {
  return withRuntimeProvisionTimeout(
    toRuntimeSubjectIncarnationHandle(subject).inspectRuntimeSubjectIncarnation(
      incarnation,
      networkConstraintsHash,
    ),
    `Runtime subject incarnation ${incarnation} inspection`,
  );
}

export async function markRuntimeSubjectIncarnationReady(
  subject: SandboxHandle,
  incarnation: number,
  networkConstraintsHash: string,
): Promise<void> {
  await withRuntimeProvisionTimeout(
    toRuntimeSubjectIncarnationHandle(subject).markRuntimeSubjectIncarnationReady(
      incarnation,
      networkConstraintsHash,
    ),
    `Runtime subject incarnation ${incarnation} readiness`,
  );
}

export async function restoreRuntimeSubjectBackup(
  subject: SandboxHandle,
  input: {
    readonly backup: ReadyRuntimeSubjectBackupRecord;
    readonly runtimeSubjectId: string;
  },
): Promise<void> {
  await withDisposedRpcResult(
    withRuntimeProvisionTimeout(
      subject.restoreBackup({
        dir: input.backup.dir,
        id: decodeSandboxBackupIdForPlatform(input.backup.id),
      }),
      `Runtime subject restore for ${input.runtimeSubjectId}`,
    ),
    discardPromiseResult,
  );
}

export async function destroyRuntimeSubjectContainer(
  bindings: ApiBindings,
  runtimeSubjectId: string,
  incarnation: number,
  timeoutMs?: number,
): Promise<void> {
  await withRuntimeProvisionTimeout(
    (async () =>
      withDisposedRpcResource(
        await getRuntimeSubjectKeepAliveHandle(bindings, runtimeSubjectId, incarnation),
        async (subject) => {
          const outcome =
            await toRuntimeSubjectIncarnationHandle(subject).destroyRuntimeSubjectIncarnation(
              incarnation,
            );
          if (outcome.kind === "stale") {
            throw new Error("Runtime subject destroy targeted a stale incarnation.");
          }
        },
      ))(),
    `Runtime subject destroy for ${runtimeSubjectId}`,
    timeoutMs,
  );
}

export async function destroyUnversionedSandboxContainer(
  bindings: ApiBindings,
  sandboxId: string,
  timeoutMs?: number,
): Promise<void> {
  await withRuntimeProvisionTimeout(
    withDisposedRpcResource(
      await getUnversionedSandboxHandle(bindings, sandboxId),
      async (sandbox) => {
        await sandbox.setKeepAlive(false);
        await sandbox.destroy();
      },
    ),
    `Sandbox destroy for ${sandboxId}`,
    timeoutMs,
  );
}

export async function clearRuntimeSubjectAgentState(
  bindings: ApiBindings,
  input: {
    readonly rules: readonly RuntimeStateClearRule[];
    readonly incarnation: number;
    readonly runtimeSubjectId: string;
    readonly stateTargets: readonly string[];
  },
): Promise<void> {
  await withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(bindings, input.runtimeSubjectId, input.incarnation),
    async (subject) => {
      const commands = input.rules.flatMap((rule) => {
        switch (rule.type) {
          case "subject_memory": {
            return [
              `rm -rf ${quoteShellArg(rule.path)}`,
              `mkdir -p ${quoteShellArg(SANDBOX_MEMORY_PATH)}`,
            ];
          }
          case "session_runtime_state": {
            return input.stateTargets.map((target) => `rm -rf ${quoteShellArg(target)}`);
          }
        }
      });

      const result = await subject.exec(`sh -lc ${quoteShellArg(commands.join("; "))}`);

      if (!result.success || result.exitCode !== 0) {
        throw new Error(
          result.stderr.trim() || result.stdout.trim() || "Runtime agent-state cleanup failed.",
        );
      }
    },
  );
}
