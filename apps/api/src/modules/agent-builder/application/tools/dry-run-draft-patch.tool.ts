import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerOutput,
  AgentBuilderReadinessContext,
} from "@mosoo/contracts/agent-builder";
import type { AgentBuilderToolPayload } from "@mosoo/contracts/agent-builder";
import { parseAgentBuilderPlannerOutput } from "@mosoo/contracts/agent-builder";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { ensureAgentEditor } from "../../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { parseAgentBuilderPlannerDraft } from "../agent-builder-draft-parser";
import {
  applyAgentBuilderDraftPatchOutputToYaml,
  findNewRepairableDraftReadinessErrors,
} from "../agent-builder-draft-patch-guardrail.service";
import { collectAgentBuilderReadinessContext } from "../agent-builder-readiness-context.service";
import type { AgentBuilderToolDefinition } from "../agent-builder-tool-runtime.service";

type CollectDryRunReadiness = (input: {
  context: AgentBuilderPlannerContext;
  proposedDraftYaml: string;
}) => Promise<AgentBuilderReadinessContext>;

export interface DryRunAgentBuilderDraftPatchOptions {
  bindings: ApiBindings;
  collectReadiness?: CollectDryRunReadiness;
  context: AgentBuilderPlannerContext;
  viewer: AuthenticatedViewer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readIncludeYaml(input: AgentBuilderToolPayload): boolean {
  const value = input["includeYaml"];

  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new Error("dry_run_draft_patch includeYaml must be a boolean.");
  }

  return value;
}

function toOutputFromNodes(
  context: AgentBuilderPlannerContext,
  nodes: unknown[],
): AgentBuilderPlannerOutput {
  const output = parseAgentBuilderPlannerOutput({
    assistantText: "Dry run Draft patch.",
    intentSummary: "Dry run Draft patch.",
    mode: "draft_patch",
    nodes,
    plannerRunId: context.plannerRunId,
    version: 1,
  });

  if (output === null) {
    throw new Error("dry_run_draft_patch nodes are invalid.");
  }

  return output;
}

function patchToNode(patch: unknown, index: number): Record<string, unknown> {
  const fieldPath =
    isRecord(patch) && typeof patch["fieldPath"] === "string" ? patch["fieldPath"] : null;

  return {
    actions: [],
    draftPatch: patch,
    ...(fieldPath === null ? {} : { fieldPath }),
    kind: "draft_patch",
    nodeKey: `dry_run_draft_patch_${index + 1}`,
    operation: "update",
    requiresConfirmation: false,
    status: "applied",
    summary: "Dry run Draft patch.",
    targetType: "draft",
  };
}

function unwrapPreparedPatchPayload(input: AgentBuilderToolPayload): AgentBuilderToolPayload {
  for (const fieldName of [
    "prepared",
    "preparedPatch",
    "prepareResult",
    "draftPatch",
    "draftPatchResult",
  ]) {
    const value = input[fieldName];

    if (isRecord(value)) {
      return value;
    }
  }

  return input;
}

function readPlannerOutput(
  context: AgentBuilderPlannerContext,
  input: AgentBuilderToolPayload,
): AgentBuilderPlannerOutput {
  const normalizedInput = unwrapPreparedPatchPayload(input);
  const rawPlannerOutput = normalizedInput["plannerOutput"];

  if (rawPlannerOutput !== undefined && rawPlannerOutput !== null) {
    const output = parseAgentBuilderPlannerOutput(rawPlannerOutput);

    if (output === null || output.mode !== "draft_patch") {
      throw new Error("dry_run_draft_patch plannerOutput must be a draft_patch output.");
    }

    return output;
  }

  const rawNodes = normalizedInput["nodes"];

  if (Array.isArray(rawNodes)) {
    return toOutputFromNodes(context, rawNodes);
  }

  const rawPatches = normalizedInput["patches"];

  if (Array.isArray(rawPatches) && rawPatches.length > 0) {
    return toOutputFromNodes(context, rawPatches.map(patchToNode));
  }

  throw new Error("dry_run_draft_patch requires plannerOutput, nodes, or patches.");
}

function readAppliedPatches(output: AgentBuilderPlannerOutput): AgentBuilderDraftPatchChange[] {
  return output.nodes.flatMap((node) => {
    const draftPatch = node.draftPatch;

    return node.status === "applied" && draftPatch?.autoApply === true ? [draftPatch] : [];
  });
}

function toParsedDraftPayload(draftYaml: string): AgentBuilderToolPayload {
  const draft = parseAgentBuilderPlannerDraft(draftYaml);

  return {
    description: draft.description,
    environmentId: draft.environmentId,
    mcpServerIds: draft.mcpServerIds,
    model: draft.model,
    name: draft.name,
    parseError: draft.parseError,
    parseStatus: draft.parseStatus,
    prompt: draft.prompt,
    provider: draft.provider,
    runtimeId: draft.runtimeId,
    skillIds: draft.skillIds,
    spaceIds: draft.spaceIds,
  };
}

async function collectReadinessForDryRun(
  options: DryRunAgentBuilderDraftPatchOptions,
  proposedDraftYaml: string,
): Promise<AgentBuilderReadinessContext> {
  if (options.collectReadiness !== undefined) {
    return options.collectReadiness({
      context: options.context,
      proposedDraftYaml,
    });
  }

  const { agent } = await ensureAgentEditor(
    options.bindings.DB,
    options.viewer.id,
    options.context.agent.agentId,
  );

  return collectAgentBuilderReadinessContext(options.bindings, {
    agent: {
      id: agent.id,
      organizationId: agent.organizationId,
      ownerId: agent.ownerId,
    },
    draftYaml: proposedDraftYaml,
  });
}

async function dryRunAgentBuilderDraftPatch(
  options: DryRunAgentBuilderDraftPatchOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  const includeYaml = readIncludeYaml(input);
  const output = readPlannerOutput(options.context, input);
  const appliedPatches = readAppliedPatches(output);
  const proposedDraftYaml = applyAgentBuilderDraftPatchOutputToYaml(
    options.context.draft.yaml,
    output,
  );
  const readiness = await collectReadinessForDryRun(options, proposedDraftYaml);
  const newRepairableErrors = findNewRepairableDraftReadinessErrors({
    after: readiness,
    before: options.context.readiness,
  });

  return {
    appliedPatchCount: appliedPatches.length,
    changedFields: appliedPatches.map((patch) => patch.fieldPath),
    mode: "draft_patch",
    proposedDraft: toParsedDraftPayload(proposedDraftYaml),
    ...(includeYaml ? { proposedDraftYaml } : {}),
    readiness,
    newRepairableErrorCount: newRepairableErrors.length,
    newRepairableErrors,
    status: newRepairableErrors.length === 0 ? "passed" : "blocked",
  };
}

export function createDryRunDraftPatchTool(
  options: DryRunAgentBuilderDraftPatchOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return dryRunAgentBuilderDraftPatch(options, input);
    },
    toolId: "dry_run_draft_patch",
  };
}
