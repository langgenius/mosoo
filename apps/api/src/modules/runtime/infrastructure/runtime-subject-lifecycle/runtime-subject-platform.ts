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
import type { RuntimeStateClearRule } from "../../domain/runtime-kind-policy";
import { withRuntimeProvisionTimeout } from "../runtime-provision-timeout";
import { toSandboxHandle } from "../sandbox-handles";
import type { SandboxHandle } from "../sandbox-handles";
import type { ReadyRuntimeSubjectBackupRecord } from "./runtime-subject-store";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function getRuntimeSubjectKeepAliveHandle(
  bindings: ApiBindings,
  runtimeSubjectId: string,
): Promise<SandboxHandle> {
  if (bindings.runtimeSubjectHandleFactory) {
    return Promise.resolve(toSandboxHandle(bindings.runtimeSubjectHandleFactory(runtimeSubjectId)));
  }

  return getCloudflareRuntimeSubjectKeepAliveHandle(bindings, runtimeSubjectId);
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
        id: input.backup.id,
      }),
      `Runtime subject restore for ${input.runtimeSubjectId}`,
    ),
    discardPromiseResult,
  );
}

export async function destroyRuntimeSubjectContainer(
  bindings: ApiBindings,
  runtimeSubjectId: string,
): Promise<void> {
  await withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(bindings, runtimeSubjectId),
    async (subject) => {
      await subject.setKeepAlive(false);
      await subject.destroy();
    },
  );
}

export async function clearRuntimeSubjectAgentState(
  bindings: ApiBindings,
  input: {
    readonly rules: readonly RuntimeStateClearRule[];
    readonly runtimeSubjectId: string;
    readonly stateTargets: readonly string[];
  },
): Promise<void> {
  await withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(bindings, input.runtimeSubjectId),
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
