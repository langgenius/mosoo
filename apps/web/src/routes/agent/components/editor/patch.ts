import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderDraftPatchReference,
} from "@mosoo/contracts/agent-builder";
import { getAgentBuilderDraftPatchAssetFieldSpec } from "@mosoo/contracts/agent-builder";

import type { McpServer, SkillInfo, SpaceBinding } from "../../agent.types";
import type { AgentEditorDraft } from "./draft";
import type { AgentFormSectionId } from "./section-ids";

export interface AgentEditorBuilderPatch {
  items: AgentBuilderDraftPatchChange[];
}

export interface AgentEditorBuilderPatchApplyResult {
  appliedSections: AgentFormSectionId[];
  blockedItems: {
    fieldPath: AgentBuilderDraftPatchFieldPath;
    reason: string;
  }[];
  draft: AgentEditorDraft;
}

interface BuilderPatchItemApplyResult {
  blockedReason: string | null;
  draft: AgentEditorDraft;
}

interface AssetSelectionResult<T> {
  items: T[];
  missingIds: string[];
}

export function applyAgentEditorPatch(
  current: AgentEditorDraft,
  patch: Record<string, unknown>,
): AgentEditorDraft {
  const next = { ...current };
  const description = patch["description"];
  const environmentId = patch["environmentId"];
  const model = patch["model"];
  const name = patch["name"];
  const provider = patch["provider"];
  const prompt = patch["prompt"];

  if (typeof name === "string") {
    next.name = name;
  }
  if (typeof description === "string") {
    next.description = description;
  }
  if (typeof model === "string") {
    next.model = model;
  }
  if (typeof provider === "string") {
    next.provider = provider;
  }
  if (typeof prompt === "string") {
    next.prompt = prompt;
  }
  if (typeof environmentId === "string" || environmentId === null) {
    return withEnvironmentId(next, environmentId);
  }

  return next;
}

export function applyAgentEditorBuilderPatch(
  current: AgentEditorDraft,
  patch: AgentEditorBuilderPatch,
): AgentEditorBuilderPatchApplyResult {
  let next = current;
  const appliedSections = new Set<AgentFormSectionId>();
  const blockedItems: AgentEditorBuilderPatchApplyResult["blockedItems"] = [];

  for (const item of patch.items) {
    const result = applyBuilderPatchItem(next, item);

    if (result.blockedReason !== null) {
      blockedItems.push({
        fieldPath: item.fieldPath,
        reason: result.blockedReason,
      });
      continue;
    }

    if (result.draft === next) {
      continue;
    }

    next = result.draft;

    if (item.sectionId !== undefined) {
      appliedSections.add(item.sectionId);
    }
  }

  return {
    appliedSections: [...appliedSections],
    blockedItems,
    draft: next,
  };
}

function applyBuilderPatchItem(
  current: AgentEditorDraft,
  item: AgentBuilderDraftPatchChange,
): BuilderPatchItemApplyResult {
  switch (item.fieldPath) {
    case "componentDecisions.environment":
      return item.value === "bound" || item.value === "created" || item.value === "skipped"
        ? applied({
            ...current,
            componentDecisions: {
              ...current.componentDecisions,
              environment: item.value,
            },
            ...(item.value === "skipped" ? { environmentId: null } : {}),
          })
        : blocked(
            current,
            "Expected Environment component decision to be bound, created, or skipped.",
          );
    case "description":
      return typeof item.value === "string"
        ? applied({ ...current, description: item.value })
        : blocked(current, "Expected a string description.");
    case "environmentId":
      return typeof item.value === "string" || item.value === null
        ? applied(withEnvironmentId(current, item.value))
        : blocked(current, "Expected an environment id or null.");
    case "kind":
      return item.value === "pet" || item.value === "cattle"
        ? applied({ ...current, kind: item.value })
        : blocked(current, "Expected agent kind to be pet or cattle.");
    case "model":
      return typeof item.value === "string"
        ? applied({ ...current, model: item.value })
        : blocked(current, "Expected a string model id.");
    case "mcpServerIds": {
      if (!Array.isArray(item.value)) {
        return blocked(current, "Expected an array of MCP server ids.");
      }

      const selection = createMcpServerSelection(current.mcpServers, item.value, item);

      return selection.missingIds.length === 0
        ? applied({ ...current, mcpServers: selection.items })
        : blocked(current, formatMissingReferences("MCP server", selection.missingIds));
    }
    case "name":
      return typeof item.value === "string"
        ? applied({ ...current, name: item.value })
        : blocked(current, "Expected a string name.");
    case "prompt":
      return typeof item.value === "string"
        ? applied({ ...current, prompt: item.value })
        : blocked(current, "Expected a string system prompt.");
    case "provider":
      return typeof item.value === "string"
        ? applied({ ...current, provider: item.value })
        : blocked(current, "Expected a string provider id.");
    case "runtimeId":
      return typeof item.value === "string"
        ? applied({ ...current, runtime: item.value })
        : blocked(current, "Expected a string runtime id.");
    case "skillIds": {
      if (!Array.isArray(item.value)) {
        return blocked(current, "Expected an array of skill ids.");
      }

      const selection = createSkillSelection(current.skills, item.value, item);

      return selection.missingIds.length === 0
        ? applied({ ...current, skills: selection.items })
        : blocked(current, formatMissingReferences("Skill", selection.missingIds));
    }
    case "spaceIds": {
      if (!Array.isArray(item.value)) {
        return blocked(current, "Expected an array of space ids.");
      }

      const selection = createSpaceSelection(current.spaces, item.value, item);

      return selection.missingIds.length === 0
        ? applied({ ...current, spaces: selection.items })
        : blocked(current, formatMissingReferences("Space", selection.missingIds));
    }
  }
}

function applied(draft: AgentEditorDraft): BuilderPatchItemApplyResult {
  return {
    blockedReason: null,
    draft,
  };
}

export function withEnvironmentId(
  current: AgentEditorDraft,
  environmentId: string | null,
): AgentEditorDraft {
  const { environment: _previousEnvironmentDecision, ...nextComponentDecisions } =
    current.componentDecisions;

  return {
    ...current,
    componentDecisions:
      environmentId === null
        ? nextComponentDecisions
        : {
            ...nextComponentDecisions,
            environment: "bound",
          },
    environmentId,
  };
}

function blocked(draft: AgentEditorDraft, reason: string): BuilderPatchItemApplyResult {
  return {
    blockedReason: reason,
    draft,
  };
}

function formatMissingReferences(label: string, missingIds: string[]): string {
  return `Missing visible ${label} references: ${missingIds.join(", ")}.`;
}

function createReferenceMap(
  item: AgentBuilderDraftPatchChange,
  fieldPath: AgentBuilderDraftPatchFieldPath,
): Map<string, AgentBuilderDraftPatchReference> {
  const spec = getAgentBuilderDraftPatchAssetFieldSpec(fieldPath);

  if (spec === null) {
    return new Map();
  }

  return new Map(
    (item.resolvedReferences ?? []).flatMap((reference) =>
      reference.targetType === spec.targetType ? [[reference.id, reference]] : [],
    ),
  );
}

function createSkillSelection(
  currentSkills: SkillInfo[],
  targetIds: string[],
  item: AgentBuilderDraftPatchChange,
): AssetSelectionResult<SkillInfo> {
  const currentById = new Map(currentSkills.map((skill) => [skill.id, skill]));
  const references = createReferenceMap(item, "skillIds");
  const missingIds: string[] = [];

  const items = targetIds.flatMap((id): SkillInfo[] => {
    const current = currentById.get(id);

    if (current !== undefined) {
      return [current];
    }

    const reference = references.get(id);

    if (reference === undefined) {
      missingIds.push(id);
      return [];
    }

    return [
      {
        filename: reference.filename ?? `${reference.id}.md`,
        id: reference.id,
        name: reference.name,
      },
    ];
  });

  return {
    items,
    missingIds,
  };
}

function createSpaceSelection(
  currentSpaces: SpaceBinding[],
  targetIds: string[],
  item: AgentBuilderDraftPatchChange,
): AssetSelectionResult<SpaceBinding> {
  const currentById = new Map(currentSpaces.map((space) => [space.id, space]));
  const references = createReferenceMap(item, "spaceIds");
  const missingIds: string[] = [];

  const items = targetIds.flatMap((id): SpaceBinding[] => {
    const current = currentById.get(id);

    if (current !== undefined) {
      return [current];
    }

    const reference = references.get(id);

    if (reference === undefined) {
      missingIds.push(id);
      return [];
    }

    return [{ id: reference.id, name: reference.name }];
  });

  return {
    items,
    missingIds,
  };
}

function createMcpServerSelection(
  currentServers: McpServer[],
  targetIds: string[],
  item: AgentBuilderDraftPatchChange,
): AssetSelectionResult<McpServer> {
  const currentById = new Map(currentServers.map((server) => [server.id, server]));
  const references = createReferenceMap(item, "mcpServerIds");
  const missingIds: string[] = [];

  const items = targetIds.flatMap((id): McpServer[] => {
    const current = currentById.get(id);

    if (current !== undefined) {
      return [current];
    }

    const reference = references.get(id);

    if (reference === undefined) {
      missingIds.push(id);
      return [];
    }

    return [
      {
        credentialMode: "runtime_resolved",
        enabled: true,
        id: reference.id,
        name: reference.name,
        type: "web",
        url: reference.url ?? "",
      },
    ];
  });

  return {
    items,
    missingIds,
  };
}
