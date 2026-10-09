import { createResolutionIssue } from "@mosoo/agent-package";
import type { AgentResolutionIssue } from "@mosoo/contracts/agent-manifest";
import { vendorCredentialsTable } from "@mosoo/db";
import type { ProjectId } from "@mosoo/id";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { getSupportedRuntimeId } from "../../runtime/domain/runtime-config";
import { resolveAvailableModels } from "../../vendor-credentials/application/available-models";

interface RuntimeCapabilityIssueInput {
  codePrefix: "agent.fork" | "agent.import" | "agent.readiness";
  database: D1Database;
  projectId: ProjectId;
  selection: {
    model: string;
    provider: string;
    runtimeId: string;
  };
}

async function hasProjectCredential(
  database: D1Database,
  projectId: ProjectId,
  provider: string,
): Promise<boolean> {
  const row = await getAppDatabase(database)
    .select({ id: vendorCredentialsTable.id })
    .from(vendorCredentialsTable)
    .where(
      and(
        eq(vendorCredentialsTable.projectId, projectId),
        eq(vendorCredentialsTable.vendorId, provider),
      ),
    )
    .limit(1)
    .get();

  return row !== undefined;
}

export async function collectRuntimeCapabilityIssues(
  input: RuntimeCapabilityIssueInput,
): Promise<AgentResolutionIssue[]> {
  const issues: AgentResolutionIssue[] = [];
  const { model, provider, runtimeId } = input.selection;
  const runtime = getRuntimeCatalogEntry(runtimeId);

  if (runtime === null || getSupportedRuntimeId(runtimeId) === null) {
    issues.push(
      createResolutionIssue({
        actionLabel: "Choose runtime",
        code: `${input.codePrefix}.runtime.unsupported`,
        message: `Unsupported runtime: ${runtimeId}.`,
        status: "unsupported",
        targetLabel: runtimeId,
        targetType: "runtime",
      }),
    );
  } else {
    const modelEntry =
      (
        await resolveAvailableModels(input.database, {
          currentModelId: model,
          currentVendorId: provider,
          projectId: input.projectId,
          runtimeId,
        })
      ).find((entry) => entry.vendorId === provider && entry.modelId === model) ?? null;

    if (!modelEntry?.available) {
      issues.push(
        createResolutionIssue({
          actionLabel: "Choose model",
          code: `${input.codePrefix}.model.unavailable`,
          message: modelEntry?.reason
            ? `Model ${model} is not available: ${modelEntry.reason}.`
            : `Model ${model} is not available for runtime ${runtimeId}.`,
          status: "unavailable",
          targetLabel: model,
          targetType: "model",
        }),
      );
    }
  }

  if (!(await hasProjectCredential(input.database, input.projectId, provider))) {
    issues.push(
      createResolutionIssue({
        actionLabel: "Configure key",
        code: `${input.codePrefix}.provider_credential.missing`,
        message: `Provider ${provider} needs a key in this Project.`,
        status: "needs_reconnect",
        targetLabel: provider,
        targetType: "provider",
      }),
    );
  }

  return issues;
}
