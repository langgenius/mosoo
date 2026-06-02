import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderDraftPatchAssetFieldPath,
  AgentBuilderDraftPatchValue,
  AgentBuilderPlanNode,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";
import { getAgentBuilderBindableAssetFieldSpec } from "@mosoo/contracts/agent-builder";
import type { AccountId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getEnvironmentRecordRow } from "../../../environments/application/environment-access.service";
import { parseAgentBuilderPlannerDraft } from "../agent-builder-draft-parser";
import { parseSkillId } from "../agent-builder-ids";
import type { AgentBuilderToolDefinition } from "../agent-builder-tool-runtime.service";
import {
  createBlockedEnvironmentBindOutput,
  createBlockedSkillReplaceOutput,
} from "./prepare-bind-asset-blocks";
import {
  readAssetReference,
  readOptionalBoolean,
  readOptionalString,
  withVisibleAsset,
} from "./prepare-bind-asset-input";
import type { BindableAssetField, BindableAssetReference } from "./prepare-bind-asset-input";
import { prepareAgentBuilderDraftPatch } from "./prepare-draft-patch.tool";
import type { PrepareAgentBuilderDraftPatchOptions } from "./prepare-draft-patch.tool";

export interface PrepareAgentBuilderBindAssetPatchOptions {
  readonly actorAccountId: AccountId;
  readonly bindings: ApiBindings;
  readonly context: PrepareAgentBuilderDraftPatchOptions["context"];
}

interface BindPatchSpec {
  readonly assetField: BindableAssetField;
  readonly nodeKeyPrefix: string;
  readonly summaryAssetName: string;
  readonly value: (asset: BindableAssetReference) => AgentBuilderDraftPatchValue;
}

interface BindPatchChange {
  readonly fieldPath: AgentBuilderDraftPatchAssetFieldPath;
  readonly nodeKey: string;
  readonly operation: "bind";
  readonly summary: string;
  readonly value: AgentBuilderDraftPatchValue;
}

type ParsedPlannerDraft = ReturnType<typeof parseAgentBuilderPlannerDraft>;

function readPlannerDraft(options: PrepareAgentBuilderBindAssetPatchOptions): ParsedPlannerDraft {
  const draft = parseAgentBuilderPlannerDraft(options.context.draft.yaml);

  if (draft.parseStatus === "failed") {
    throw new Error(draft.parseError ?? "Agent Builder draft YAML could not be parsed.");
  }

  return draft;
}

function readNodeKey(
  input: AgentBuilderToolPayload,
  prefix: string,
  asset: BindableAssetReference,
): string {
  return readOptionalString(input, "nodeKey") ?? `${prefix}_${asset.id}`;
}

function createBindChange(
  input: AgentBuilderToolPayload,
  spec: BindPatchSpec,
  asset: BindableAssetReference,
): BindPatchChange {
  const assetSpec = getAgentBuilderBindableAssetFieldSpec(spec.assetField);

  return {
    fieldPath: assetSpec.fieldPath,
    nodeKey: readNodeKey(input, spec.nodeKeyPrefix, asset),
    operation: "bind",
    summary:
      readOptionalString(input, "summary") ??
      `Bind ${spec.summaryAssetName} ${asset.name} to this Agent Draft.`,
    value: spec.value(asset),
  };
}

async function prepareBindPatch(
  options: PrepareAgentBuilderBindAssetPatchOptions,
  input: AgentBuilderToolPayload,
  spec: BindPatchSpec,
): Promise<AgentBuilderToolPayload> {
  const asset = readAssetReference(input, options.context, spec.assetField);
  const context = withVisibleAsset(options.context, spec.assetField, asset);

  return prepareAgentBuilderDraftPatch(
    {
      actorAccountId: options.actorAccountId,
      bindings: options.bindings,
      context,
    },
    { changes: [createBindChange(input, spec, asset)] },
  );
}

async function prepareAgentBuilderBindSkillPatch(
  options: PrepareAgentBuilderBindAssetPatchOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  return prepareBindPatch(options, input, {
    assetField: "skill",
    nodeKeyPrefix: "prepare_bind_skill_patch",
    summaryAssetName: "Skill",
    value: (skill) => [skill.id],
  });
}

async function prepareAgentBuilderBindMcpPatch(
  options: PrepareAgentBuilderBindAssetPatchOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  return prepareBindPatch(options, input, {
    assetField: "mcpServer",
    nodeKeyPrefix: "prepare_bind_mcp_patch",
    summaryAssetName: "MCP Server",
    value: (mcpServer) => [mcpServer.id],
  });
}

async function prepareAgentBuilderReplaceSkillPatch(
  options: PrepareAgentBuilderBindAssetPatchOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  const skill = readAssetReference(input, options.context, "skill");
  const nodeKey = readNodeKey(input, "prepare_replace_skill_patch", skill);
  const rawReplaceSkillId = readOptionalString(input, "replaceSkillId");
  const replaceSkillId =
    rawReplaceSkillId === null ? null : parseSkillId(rawReplaceSkillId, "replaceSkillId");
  const replaceAllExistingSkills = readOptionalBoolean(input, "replaceAllExistingSkills");
  const draft = readPlannerDraft(options);
  const currentSkillIds = draft.skillIds;

  if (currentSkillIds.length > 1 && replaceSkillId === null && !replaceAllExistingSkills) {
    return createBlockedSkillReplaceOutput({
      nodeKey,
      reason:
        "Draft has multiple Skills; choose the exact existing Skill to replace or explicitly replace all Skills.",
      skillName: skill.name,
    });
  }

  if (replaceSkillId !== null && !currentSkillIds.includes(replaceSkillId)) {
    return createBlockedSkillReplaceOutput({
      nodeKey,
      reason: `Draft does not currently bind Skill ${replaceSkillId}; replacement was not applied.`,
      skillName: skill.name,
    });
  }

  const nextSkillIds =
    replaceAllExistingSkills || currentSkillIds.length === 0
      ? [skill.id]
      : currentSkillIds.map((currentSkillId) =>
          replaceSkillId === null || currentSkillId === replaceSkillId ? skill.id : currentSkillId,
        );
  const nextUniqueSkillIds = [...new Set(nextSkillIds)];
  const draftPatch = {
    autoApply: true,
    baseDraftRevision: options.context.draft.revision,
    baseValue: currentSkillIds,
    fieldPath: "skillIds",
    resolvedReferences: [
      {
        bindingState: skill.bindingState,
        filename: `${skill.id}.md`,
        id: skill.id,
        name: skill.name,
        targetType: "skill",
      },
    ],
    sectionId: "integrations",
    value: nextUniqueSkillIds,
  } satisfies AgentBuilderDraftPatchChange;
  const node: AgentBuilderPlanNode = {
    actions: [],
    draftPatch,
    fieldPath: "skillIds",
    kind: "draft_patch",
    nodeKey,
    operation: "update",
    requiresConfirmation: false,
    status: "applied",
    summary:
      readOptionalString(input, "summary") ?? `Replace current Skill selection with ${skill.name}.`,
    targetType: "draft",
  };

  return {
    appliedCount: 1,
    blockedCount: 0,
    itemCount: 1,
    mode: "draft_patch",
    nodes: [node],
    patches: [draftPatch],
    status: "ready",
  };
}

async function prepareAgentBuilderBindSpacePatch(
  options: PrepareAgentBuilderBindAssetPatchOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  return prepareBindPatch(options, input, {
    assetField: "space",
    nodeKeyPrefix: "prepare_bind_space_patch",
    summaryAssetName: "Space",
    value: (space) => [space.id],
  });
}

async function prepareAgentBuilderBindEnvironmentPatch(
  options: PrepareAgentBuilderBindAssetPatchOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  const environment = readAssetReference(input, options.context, "environment");
  const replaceCurrentNonDefaultEnvironment = readOptionalBoolean(
    input,
    "replaceCurrentNonDefaultEnvironment",
  );
  const draft = readPlannerDraft(options);
  const currentEnvironmentId = draft.environmentId;

  if (currentEnvironmentId !== null) {
    const currentEnvironment = await getEnvironmentRecordRow(
      options.bindings.DB,
      currentEnvironmentId,
    );

    if (currentEnvironment === null) {
      throw new Error(`Current draft Environment ${currentEnvironmentId} was not found.`);
    }

    if (currentEnvironment.ownerId !== null && !replaceCurrentNonDefaultEnvironment) {
      return createBlockedEnvironmentBindOutput({
        environmentName: environment.name,
        nodeKey: readNodeKey(input, "prepare_bind_environment_patch", environment),
      });
    }
  }

  return prepareBindPatch(options, input, {
    assetField: "environment",
    nodeKeyPrefix: "prepare_bind_environment_patch",
    summaryAssetName: "Environment",
    value: (asset) => asset.id,
  });
}

export function createPrepareBindSpacePatchTool(
  options: PrepareAgentBuilderBindAssetPatchOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return prepareAgentBuilderBindSpacePatch(options, input);
    },
    toolId: "prepare_bind_space_patch",
  };
}

export function createPrepareBindSkillPatchTool(
  options: PrepareAgentBuilderBindAssetPatchOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return prepareAgentBuilderBindSkillPatch(options, input);
    },
    toolId: "prepare_bind_skill_patch",
  };
}

export function createPrepareBindMcpPatchTool(
  options: PrepareAgentBuilderBindAssetPatchOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return prepareAgentBuilderBindMcpPatch(options, input);
    },
    toolId: "prepare_bind_mcp_patch",
  };
}

export function createPrepareReplaceSkillPatchTool(
  options: PrepareAgentBuilderBindAssetPatchOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return prepareAgentBuilderReplaceSkillPatch(options, input);
    },
    toolId: "prepare_replace_skill_patch",
  };
}

export function createPrepareBindEnvironmentPatchTool(
  options: PrepareAgentBuilderBindAssetPatchOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return prepareAgentBuilderBindEnvironmentPatch(options, input);
    },
    toolId: "prepare_bind_environment_patch",
  };
}
