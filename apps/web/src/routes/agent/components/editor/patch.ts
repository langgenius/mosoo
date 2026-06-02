import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderDraftPatchReference,
  AgentBuilderDraftPatchValue,
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
    next.environmentId = environmentId;
  }

  return next;
}

export function applyAgentEditorBuilderPatch(
  current: AgentEditorDraft,
  patch: AgentEditorBuilderPatch,
  currentDraftRevision: string,
): AgentEditorBuilderPatchApplyResult {
  let next = current;
  const appliedSections = new Set<AgentFormSectionId>();
  const blockedItems: AgentEditorBuilderPatchApplyResult["blockedItems"] = [];

  for (const item of patch.items) {
    const conflictReason = getPatchConflictReason(current, item, currentDraftRevision);

    if (conflictReason !== null) {
      blockedItems.push({
        fieldPath: item.fieldPath,
        reason: conflictReason,
      });
      continue;
    }

    const updated = applyBuilderPatchItem(next, item);

    if (updated === next) {
      continue;
    }

    next = updated;

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

function getPatchConflictReason(
  current: AgentEditorDraft,
  item: AgentBuilderDraftPatchChange,
  currentDraftRevision: string,
): string | null {
  if (
    item.baseValue === undefined &&
    item.baseDraftRevision !== undefined &&
    item.baseDraftRevision !== currentDraftRevision
  ) {
    return "Draft revision changed since this Builder patch was generated.";
  }

  if (item.baseValue === undefined) {
    return null;
  }

  const currentValue = readDraftFieldValue(current, item.fieldPath);

  if (!draftPatchValuesEqual(currentValue, item.baseValue)) {
    return "Draft changed since this Builder patch was generated.";
  }

  return null;
}

function applyBuilderPatchItem(
  current: AgentEditorDraft,
  item: AgentBuilderDraftPatchChange,
): AgentEditorDraft {
  switch (item.fieldPath) {
    case "description":
      return typeof item.value === "string" ? { ...current, description: item.value } : current;
    case "environmentId":
      return typeof item.value === "string" || item.value === null
        ? { ...current, environmentId: item.value }
        : current;
    case "model":
      return typeof item.value === "string" ? { ...current, model: item.value } : current;
    case "mcpServerIds":
      return Array.isArray(item.value)
        ? { ...current, mcpServers: createMcpServerSelection(current.mcpServers, item.value, item) }
        : current;
    case "name":
      return typeof item.value === "string" ? { ...current, name: item.value } : current;
    case "prompt":
      return typeof item.value === "string" ? { ...current, prompt: item.value } : current;
    case "provider":
      return typeof item.value === "string" ? { ...current, provider: item.value } : current;
    case "runtimeId":
      return typeof item.value === "string" ? { ...current, runtime: item.value } : current;
    case "skillIds":
      return Array.isArray(item.value)
        ? { ...current, skills: createSkillSelection(current.skills, item.value, item) }
        : current;
    case "spaceIds":
      return Array.isArray(item.value)
        ? { ...current, spaces: createSpaceSelection(current.spaces, item.value, item) }
        : current;
  }
}

function readDraftFieldValue(
  draft: AgentEditorDraft,
  fieldPath: AgentBuilderDraftPatchFieldPath,
): AgentBuilderDraftPatchValue {
  switch (fieldPath) {
    case "description":
      return draft.description;
    case "environmentId":
      return draft.environmentId;
    case "model":
      return draft.model;
    case "mcpServerIds":
      return draft.mcpServers.map((server) => server.id);
    case "name":
      return draft.name;
    case "prompt":
      return draft.prompt;
    case "provider":
      return draft.provider;
    case "runtimeId":
      return draft.runtime;
    case "skillIds":
      return draft.skills.flatMap((skill) => (skill.state === "tombstone" ? [] : [skill.id]));
    case "spaceIds":
      return draft.spaces.map((space) => space.id);
  }
}

function draftPatchValuesEqual(
  left: AgentBuilderDraftPatchValue,
  right: AgentBuilderDraftPatchValue,
): boolean {
  return (
    JSON.stringify(normalizeDraftPatchValue(left)) ===
    JSON.stringify(normalizeDraftPatchValue(right))
  );
}

function normalizeDraftPatchValue(value: AgentBuilderDraftPatchValue): AgentBuilderDraftPatchValue {
  if (!Array.isArray(value)) {
    return value;
  }

  return [...value];
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
): SkillInfo[] {
  const currentById = new Map(currentSkills.map((skill) => [skill.id, skill]));
  const references = createReferenceMap(item, "skillIds");

  return targetIds.flatMap((id): SkillInfo[] => {
    const current = currentById.get(id);

    if (current !== undefined) {
      return [
        {
          ...current,
          ...(current.state === "tombstone" ? { state: "active" as const } : {}),
        },
      ];
    }

    const reference = references.get(id);

    if (reference === undefined) {
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
}

function createSpaceSelection(
  currentSpaces: SpaceBinding[],
  targetIds: string[],
  item: AgentBuilderDraftPatchChange,
): SpaceBinding[] {
  const currentById = new Map(currentSpaces.map((space) => [space.id, space]));
  const references = createReferenceMap(item, "spaceIds");

  return targetIds.flatMap((id): SpaceBinding[] => {
    const current = currentById.get(id);

    if (current !== undefined) {
      return [current];
    }

    const reference = references.get(id);

    return reference === undefined ? [] : [{ id: reference.id, name: reference.name }];
  });
}

function createMcpServerSelection(
  currentServers: McpServer[],
  targetIds: string[],
  item: AgentBuilderDraftPatchChange,
): McpServer[] {
  const currentById = new Map(currentServers.map((server) => [server.id, server]));
  const references = createReferenceMap(item, "mcpServerIds");

  return targetIds.flatMap((id): McpServer[] => {
    const current = currentById.get(id);

    if (current !== undefined) {
      return [current];
    }

    const reference = references.get(id);

    return reference === undefined
      ? []
      : [
          {
            credentialMode: "runtime_resolved",
            enabled: true,
            id: reference.id,
            name: reference.name,
            type: "web",
            url: "",
          },
        ];
  });
}
