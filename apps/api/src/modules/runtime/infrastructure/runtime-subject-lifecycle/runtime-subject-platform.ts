import { sandboxesTable } from "@mosoo/db";
import { promiseWithTimeout } from "@mosoo/effects";
import { parsePlatformId } from "@mosoo/id";
import type { SandboxId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import { withDisposedRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import { requireCloudflareSandboxBinding } from "../../../../platform/cloudflare/sandbox-binding";
import { SANDBOX_STARTUP_RPC_TIMEOUT_MS } from "../../../../platform/cloudflare/sandbox-startup";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { SandboxHandle } from "../sandbox-handles";

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

export async function getRuntimeSubjectKeepAliveHandle(
  bindings: ApiBindings,
  runtimeSubjectId: string,
): Promise<SandboxHandle> {
  if (bindings.runtimeSubjectHandleFactory) {
    return bindings.runtimeSubjectHandleFactory(runtimeSubjectId) as SandboxHandle;
  }

  const sandboxBinding = await readRuntimeSubjectSandboxBinding(bindings, runtimeSubjectId);
  const { getSandbox } = await import("@cloudflare/sandbox");
  return getSandbox(requireCloudflareSandboxBinding(bindings, sandboxBinding), runtimeSubjectId, {
    keepAlive: true,
    normalizeId: true,
  }) as unknown as SandboxHandle;
}

export async function startRuntimeSubjectContainer(
  subject: SandboxHandle,
  input: { allowStartupRecovery: boolean; runtimeSubjectId: string },
): Promise<void> {
  try {
    await subject.setKeepAlive(true);
    await promiseWithTimeout(
      subject.ensureContainerReady({ allowRecovery: input.allowStartupRecovery }),
      { label: "Runtime subject container startup", timeoutMs: SANDBOX_STARTUP_RPC_TIMEOUT_MS },
    );
  } catch (error) {
    logWarn("runtime.subject.prepare.failed", {
      ...createErrorLogContext(error),
      runtimeSubjectId: input.runtimeSubjectId,
    });
    throw error;
  }
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
