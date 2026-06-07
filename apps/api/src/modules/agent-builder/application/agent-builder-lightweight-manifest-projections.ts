import type { UpdateAgentConfigInput } from "@mosoo/contracts/agent";
import type { AgentId } from "@mosoo/id";

import type {
  AgentBuilderLightweightPlannerDraftContext,
  AgentBuilderWorkflowDraftSnapshot,
} from "./agent-builder-lightweight-draft-types";
import { parseAgentBuilderLightweightManifestYaml } from "./agent-builder-lightweight-manifest";

function hasText(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

function emptyPlannerDraftContext(
  parseError: string | null,
): AgentBuilderLightweightPlannerDraftContext {
  return {
    componentDecisions: {},
    description: null,
    environmentId: null,
    kind: null,
    mcpServerIds: [],
    mcpServersRepresented: false,
    model: null,
    name: null,
    parseError,
    parseStatus: parseError === null ? "parsed" : "failed",
    prompt: null,
    provider: null,
    runtimeId: null,
    skillIds: [],
    spaceIds: [],
    spaces: [],
  };
}

export function toAgentBuilderUpdateAgentConfigInput(
  agentId: AgentId,
  draftYaml: string,
): UpdateAgentConfigInput {
  const parsed = parseAgentBuilderLightweightManifestYaml(draftYaml);

  if (parsed.status === "failed") {
    throw new Error(`Cannot apply Agent Builder Manifest: ${parsed.error}`);
  }

  const manifest = parsed.manifest;
  const missingFields = [
    manifest.kind === null ? "kind" : null,
    hasText(manifest.name) ? null : "name",
    hasText(manifest.description) ? null : "description",
    hasText(manifest.runtimeId) ? null : "runtimeId",
    hasText(manifest.provider) ? null : "provider",
    hasText(manifest.model) ? null : "model",
    hasText(manifest.prompt) ? null : "prompt",
  ].filter((field): field is string => field !== null);

  if (missingFields.length > 0) {
    throw new Error(`Cannot apply incomplete Agent Builder Manifest: ${missingFields.join(", ")}.`);
  }

  if (
    manifest.kind === null ||
    !hasText(manifest.name) ||
    !hasText(manifest.description) ||
    !hasText(manifest.runtimeId) ||
    !hasText(manifest.provider) ||
    !hasText(manifest.model) ||
    !hasText(manifest.prompt)
  ) {
    throw new Error("Cannot apply incomplete Agent Builder Manifest.");
  }

  return {
    agentId,
    builder: manifest.builder,
    description: manifest.description,
    environment: {
      boundSpaceIds: manifest.spaceIds,
      environmentId: manifest.environmentId,
    },
    kind: manifest.kind,
    mcpServerIds: manifest.activeMcpServerIds,
    model: manifest.model,
    name: manifest.name,
    prompt: manifest.prompt,
    provider: manifest.provider,
    runtimeId: manifest.runtimeId,
    skillIds: manifest.activeSkillIds,
  };
}

export function toAgentBuilderWorkflowDraftSnapshot(
  draftYaml: string,
): AgentBuilderWorkflowDraftSnapshot {
  const parsed = parseAgentBuilderLightweightManifestYaml(draftYaml);

  if (parsed.status === "failed") {
    return {
      componentDecisions: {},
      description: null,
      environmentId: null,
      kind: null,
      model: null,
      name: null,
      parseError: parsed.error,
      parseStatus: "failed",
      prompt: null,
      provider: null,
      runtimeId: null,
    };
  }

  const { manifest } = parsed;

  return {
    componentDecisions: manifest.componentDecisions,
    description: manifest.description,
    environmentId: manifest.environmentId,
    kind: manifest.kind,
    model: manifest.model,
    name: manifest.name,
    parseError: null,
    parseStatus: "parsed",
    prompt: manifest.prompt,
    provider: manifest.provider,
    runtimeId: manifest.runtimeId,
  };
}

export function toAgentBuilderPlannerDraftContext(
  draftYaml: string,
): AgentBuilderLightweightPlannerDraftContext {
  const parsed = parseAgentBuilderLightweightManifestYaml(draftYaml);

  if (parsed.status === "failed") {
    return emptyPlannerDraftContext(parsed.error);
  }

  const { manifest } = parsed;

  return {
    componentDecisions: manifest.componentDecisions,
    description: manifest.description,
    environmentId: manifest.environmentId,
    kind: manifest.kind,
    mcpServerIds: manifest.mcpServerIds,
    mcpServersRepresented: manifest.mcpServersRepresented,
    model: manifest.model,
    name: manifest.name,
    parseError: null,
    parseStatus: "parsed",
    prompt: manifest.prompt,
    provider: manifest.provider,
    runtimeId: manifest.runtimeId,
    skillIds: manifest.skillIds,
    spaceIds: manifest.spaceIds,
    spaces: manifest.spaceBindings,
  };
}
