import {
  SANDBOX_CACHE_PATH,
  SANDBOX_MEMORY_PATH,
  SANDBOX_SESSION_ROOT,
} from "@mosoo/agent-driver/paths";
import { sandboxesTable } from "@mosoo/db";
import { discardPromiseResult } from "@mosoo/effects";
import { parsePlatformId } from "@mosoo/id";
import type { SandboxId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { SandboxContainerObservation } from "../../../../adapters/durable-objects/sandbox.do";
import { createErrorLogContext, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import {
  withDisposedRpcResource,
  withDisposedRpcResult,
} from "../../../../platform/cloudflare/rpc-disposal";
import {
  requireCloudflareSandboxBinding,
  requireSandboxBinding,
} from "../../../../platform/cloudflare/sandbox-binding";
import { SANDBOX_STARTUP_RPC_TIMEOUT_MS } from "../../../../platform/cloudflare/sandbox-startup";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { RuntimeStateClearRule } from "../../domain/runtime-kind-policy";
import type { SandboxNetworkConstraints } from "../../domain/sandbox-network-constraints";
import { withRuntimeProvisionTimeout } from "../runtime-provision-timeout";
import { decodeSandboxBackupIdForPlatform } from "../sandbox-backup-id";
import { toSandboxHandle } from "../sandbox-handles";
import type { SandboxHandle } from "../sandbox-handles";
import type { ReadyRuntimeSubjectBackupRecord } from "./runtime-subject-store";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function readRuntimeSubjectSandboxBinding(
  bindings: ApiBindings,
  runtimeSubjectId: string,
): Promise<string> {
  const record = await getAppDatabase(bindings.DB)
    .select({ sandboxBinding: sandboxesTable.sandboxBinding })
    .from(sandboxesTable)
    .where(
      eq(sandboxesTable.id, parsePlatformId<SandboxId>(runtimeSubjectId, "Runtime subject ID")),
    )
    .get();
  if (!record) throw new Error("Runtime subject has no recorded Sandbox binding.");
  return record.sandboxBinding;
}

export async function getRuntimeSubjectContainerObservation(
  bindings: ApiBindings,
  runtimeSubjectId: string,
): Promise<SandboxContainerObservation> {
  const sandboxId = parsePlatformId<SandboxId>(runtimeSubjectId, "Runtime subject ID");
  const binding = await readRuntimeSubjectSandboxBinding(bindings, sandboxId);
  // Match getSandbox(normalizeId: true), without its configuration RPCs.
  const subject = requireSandboxBinding(bindings, binding).getByName(sandboxId.toLowerCase());
  return withDisposedRpcResource(subject, (handle) => handle.getContainerObservation());
}

export async function getRuntimeSubjectKeepAliveHandle(
  bindings: ApiBindings,
  runtimeSubjectId: string,
): Promise<SandboxHandle> {
  if (bindings.runtimeSubjectHandleFactory) {
    return Promise.resolve(toSandboxHandle(bindings.runtimeSubjectHandleFactory(runtimeSubjectId)));
  }

  return getCloudflareRuntimeSubjectKeepAliveHandle(
    bindings,
    runtimeSubjectId,
    await readRuntimeSubjectSandboxBinding(bindings, runtimeSubjectId),
  );
}

async function getCloudflareRuntimeSubjectKeepAliveHandle(
  bindings: ApiBindings,
  runtimeSubjectId: string,
  sandboxBinding: string,
): Promise<SandboxHandle> {
  const { getSandbox } = await import("@cloudflare/sandbox");
  const sandbox = getSandbox(
    requireCloudflareSandboxBinding(bindings, sandboxBinding),
    runtimeSubjectId,
    {
      keepAlive: true,
      normalizeId: true,
    },
  );
  return toSandboxHandle(sandbox);
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

export async function prepareRuntimeSubjectFilesystem(
  subject: SandboxHandle,
  input: { allowStartupRecovery: boolean; runtimeSubjectId: string },
): Promise<void> {
  async function step(name: string, task: () => Promise<void>, timeoutMs?: number): Promise<void> {
    const startedAt = Date.now();
    try {
      await withRuntimeProvisionTimeout(task(), `Runtime subject ${name}`, timeoutMs);
      logInfo("runtime.subject.prepare.step", {
        durationMs: Date.now() - startedAt,
        runtimeSubjectId: input.runtimeSubjectId,
        step: name,
      });
    } catch (error) {
      logWarn("runtime.subject.prepare.failed", {
        ...createErrorLogContext(error),
        durationMs: Date.now() - startedAt,
        runtimeSubjectId: input.runtimeSubjectId,
        step: name,
      });
      throw error;
    }
  }

  await step("keep-alive", () => subject.setKeepAlive(true));
  await step(
    "container startup",
    () => subject.ensureContainerReady({ allowRecovery: input.allowStartupRecovery }),
    SANDBOX_STARTUP_RPC_TIMEOUT_MS,
  );
  // These operations now run against a ready container. Each keeps the original
  // 15s limit and identifies the failing path instead of hiding startup retries
  // inside three parallel implicit default-session initializations.
  await Promise.all(
    [SANDBOX_CACHE_PATH, SANDBOX_MEMORY_PATH, SANDBOX_SESSION_ROOT].map((path) =>
      step(`mkdir ${path}`, () => subject.mkdir(path, { recursive: true })),
    ),
  );
}

export async function restoreRuntimeSubjectBackup(
  subject: SandboxHandle,
  input: {
    readonly backup: ReadyRuntimeSubjectBackupRecord;
    readonly localBucket: boolean;
    readonly runtimeSubjectId: string;
  },
): Promise<void> {
  await withDisposedRpcResult(
    withRuntimeProvisionTimeout(
      subject.restoreBackup({
        dir: input.backup.dir,
        id: decodeSandboxBackupIdForPlatform(input.backup.id),
        localBucket: input.localBucket,
      }),
      `Runtime subject restore for ${input.runtimeSubjectId}`,
    ),
    discardPromiseResult,
  );
}

export async function destroyRuntimeSubjectContainer(
  bindings: ApiBindings,
  runtimeSubjectId: string,
  timeoutMs?: number,
): Promise<void> {
  await withRuntimeProvisionTimeout(
    (async () =>
      withDisposedRpcResource(
        await getRuntimeSubjectKeepAliveHandle(bindings, runtimeSubjectId),
        async (subject) => {
          await subject.setKeepAlive(false);
          await subject.destroy();
        },
      ))(),
    `Runtime subject destroy for ${runtimeSubjectId}`,
    timeoutMs,
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
