import type {
  AgentBuilderToolPayload,
  AgentBuilderVisibleAssetBindingState,
  AgentBuilderVisibleAssetKind,
  AgentBuilderVisibleChannelSummary,
  AgentBuilderVisibleEnvironmentSummary,
  AgentBuilderVisibleMcpServerSummary,
  AgentBuilderVisibleSkillSummary,
  AgentBuilderVisibleSpaceSummary,
} from "@mosoo/contracts/agent-builder";
import {
  AGENT_BUILDER_VISIBLE_ASSET_BINDING_STATE_VALUES,
  isAgentBuilderVisibleAssetBindingState,
} from "@mosoo/contracts/agent-builder";
import type { OrganizationId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { collectAgentBuilderVisibleAssetSummaries } from "../agent-builder-visible-asset-summaries";
import { createAgentBuilderVisibleAssetProviderInput } from "../agent-builder-visible-assets.service";
import type {
  AgentBuilderVisibleAssetSummariesCollector,
  AgentBuilderVisibleAssetSummaryCollections,
} from "../agent-builder-visible-assets.types";

export type SearchableAgentBuilderAssetType = Exclude<
  AgentBuilderVisibleAssetKind,
  "selected_space_files"
>;

export interface SearchableAgentBuilderAsset {
  readonly assetType: SearchableAgentBuilderAssetType;
  readonly bindingState: AgentBuilderVisibleAssetBindingState;
  readonly fields: AgentBuilderToolPayload;
  readonly id: string;
  readonly name: string;
  readonly searchableText: string;
}

export interface AgentBuilderAssetToolContextOptions {
  bindings: ApiBindings;
  collectSummaries?: AgentBuilderVisibleAssetSummariesCollector;
  draftYaml: string;
  organizationId: OrganizationId;
  viewer: AuthenticatedViewer;
}

export const SEARCHABLE_AGENT_BUILDER_ASSET_TYPES = [
  "channel",
  "environment",
  "mcp_server",
  "skill",
  "space",
] as const satisfies readonly SearchableAgentBuilderAssetType[];

export const AGENT_BUILDER_ASSET_BINDING_STATES = [
  ...AGENT_BUILDER_VISIBLE_ASSET_BINDING_STATE_VALUES,
] as const satisfies readonly AgentBuilderVisibleAssetBindingState[];

const SEARCH_ALIASES_BY_ASSET_TYPE: Record<SearchableAgentBuilderAssetType, readonly string[]> = {
  channel: ["channel"],
  environment: ["environment", "env"],
  mcp_server: ["mcp server", "mcp"],
  skill: ["skill"],
  space: ["space"],
};

function isSearchableAgentBuilderAssetType(
  value: string,
): value is SearchableAgentBuilderAssetType {
  return (
    value === "channel" ||
    value === "environment" ||
    value === "mcp_server" ||
    value === "skill" ||
    value === "space"
  );
}

export function isAgentBuilderAssetBindingState(
  value: string,
): value is AgentBuilderVisibleAssetBindingState {
  return isAgentBuilderVisibleAssetBindingState(value);
}

export function normalizeAgentBuilderSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/['"`“”‘’]/gu, "")
    .replace(/[_\-–—/:：]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeAgentBuilderAssetType(input: {
  createUnsupportedMessage?: (value: string) => string;
  fieldName: string;
  toolName: string;
  value: string;
}): SearchableAgentBuilderAssetType {
  const value = input.value.trim();

  if (value === "mcp") {
    return "mcp_server";
  }

  if (isSearchableAgentBuilderAssetType(value)) {
    return value;
  }

  throw new Error(
    input.createUnsupportedMessage?.(value) ??
      `${input.toolName} ${input.fieldName} is unsupported: ${value}.`,
  );
}

function compactAgentBuilderSearchParts(
  parts: readonly (boolean | null | number | string | readonly string[])[],
): string {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter((part) => part !== null && typeof part !== "boolean")
    .map((part) => String(part).trim())
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
}

export function scoreSearchableAgentBuilderAsset(
  asset: SearchableAgentBuilderAsset,
  query: string,
): number {
  if (query.length === 0) {
    return 1;
  }

  const normalizedName = normalizeAgentBuilderSearchText(asset.name);
  const normalizedSearchableText = normalizeAgentBuilderSearchText(asset.searchableText);

  if (normalizedName === query) {
    return 100;
  }

  if (query.includes(normalizedName)) {
    return 90;
  }

  if (normalizedName.startsWith(query)) {
    return 80;
  }

  if (normalizedName.includes(query)) {
    return 60;
  }

  const queryTokens = query.split(" ").filter((token) => token.length > 1);
  const searchableTokens = new Set(normalizedSearchableText.split(" "));

  if (queryTokens.length > 1 && queryTokens.every((token) => searchableTokens.has(token))) {
    return 40;
  }

  return normalizedSearchableText.includes(query) ? 20 : 0;
}

function assetTypeSearchAliases(assetType: SearchableAgentBuilderAssetType): readonly string[] {
  return SEARCH_ALIASES_BY_ASSET_TYPE[assetType];
}

function bindingStateSortRank(state: AgentBuilderVisibleAssetBindingState): number {
  if (state === "bound") {
    return 0;
  }

  return state === "not_bound" ? 1 : 2;
}

export function compareSearchableAgentBuilderAssets(
  left: SearchableAgentBuilderAsset,
  right: SearchableAgentBuilderAsset,
): number {
  const bindingOrder =
    bindingStateSortRank(left.bindingState) - bindingStateSortRank(right.bindingState);

  if (bindingOrder !== 0) {
    return bindingOrder;
  }

  const typeOrder = left.assetType.localeCompare(right.assetType);

  if (typeOrder !== 0) {
    return typeOrder;
  }

  const nameOrder = left.name.localeCompare(right.name);
  return nameOrder === 0 ? left.id.localeCompare(right.id) : nameOrder;
}

function projectSkill(skill: AgentBuilderVisibleSkillSummary): SearchableAgentBuilderAsset {
  return {
    assetType: "skill",
    bindingState: skill.bindingState,
    fields: {
      description: skill.description,
      ownerName: skill.ownerName,
      sourceKind: skill.sourceKind,
      updatedAt: skill.updatedAt,
    },
    id: skill.id,
    name: skill.name,
    searchableText: compactAgentBuilderSearchParts([
      assetTypeSearchAliases("skill"),
      skill.name,
      skill.description,
      skill.ownerName,
      skill.sourceKind,
    ]),
  };
}

function projectMcpServer(
  server: AgentBuilderVisibleMcpServerSummary,
): SearchableAgentBuilderAsset {
  return {
    assetType: "mcp_server",
    bindingState: server.bindingState,
    fields: {
      authType: server.authType,
      authorizationState: server.authorizationState,
      credentialScope: server.credentialScope,
      credentialStatus: server.credentialStatus,
      description: server.description,
      enabled: server.enabled,
      source: server.source,
      updatedAt: server.updatedAt,
      urlHost: server.urlHost,
    },
    id: server.id,
    name: server.name,
    searchableText: compactAgentBuilderSearchParts([
      assetTypeSearchAliases("mcp_server"),
      server.name,
      server.description,
      server.source,
      server.urlHost,
      server.authorizationState,
      server.credentialStatus,
    ]),
  };
}

function projectEnvironment(
  environment: AgentBuilderVisibleEnvironmentSummary,
): SearchableAgentBuilderAsset {
  return {
    assetType: "environment",
    bindingState: environment.bindingState,
    fields: {
      allowMcpServers: environment.allowMcpServers,
      allowPackageManagers: environment.allowPackageManagers,
      description: environment.description,
      envVarKeys: environment.envVarKeys,
      isBuiltIn: environment.isBuiltIn,
      isDefault: environment.isDefault,
      networkPolicy: environment.networkPolicy,
      packageManagers: environment.packageManagers,
      setupScriptConfigured: environment.setupScriptConfigured,
      updatedAt: environment.updatedAt,
    },
    id: environment.id,
    name: environment.name,
    searchableText: compactAgentBuilderSearchParts([
      assetTypeSearchAliases("environment"),
      environment.name,
      environment.description,
      environment.envVarKeys,
      environment.networkPolicy,
      environment.packageManagers,
    ]),
  };
}

function projectSpace(space: AgentBuilderVisibleSpaceSummary): SearchableAgentBuilderAsset {
  return {
    assetType: "space",
    bindingState: space.bindingState,
    fields: {
      role: space.role,
      visibility: space.visibility,
    },
    id: space.id,
    name: space.name,
    searchableText: compactAgentBuilderSearchParts([
      assetTypeSearchAliases("space"),
      space.name,
      space.role,
      space.visibility,
    ]),
  };
}

function projectChannel(channel: AgentBuilderVisibleChannelSummary): SearchableAgentBuilderAsset {
  return {
    assetType: "channel",
    bindingState: channel.bindingState,
    fields: {
      sourceState: channel.sourceState,
    },
    id: channel.id,
    name: channel.name,
    searchableText: compactAgentBuilderSearchParts([
      assetTypeSearchAliases("channel"),
      channel.name,
      channel.sourceState,
    ]),
  };
}

export function flattenSearchableAgentBuilderAssets(
  summaries: AgentBuilderVisibleAssetSummaryCollections,
): SearchableAgentBuilderAsset[] {
  return [
    ...summaries.channels.map(projectChannel),
    ...summaries.environments.map(projectEnvironment),
    ...summaries.mcpServers.map(projectMcpServer),
    ...summaries.skills.map(projectSkill),
    ...summaries.spaces.map(projectSpace),
  ];
}

export function toAgentBuilderToolAsset(
  asset: SearchableAgentBuilderAsset,
): AgentBuilderToolPayload {
  return {
    assetType: asset.assetType,
    bindingState: asset.bindingState,
    fields: asset.fields,
    id: asset.id,
    name: asset.name,
  };
}

export async function collectSummariesForAgentBuilderAssetTool(
  options: AgentBuilderAssetToolContextOptions,
): Promise<AgentBuilderVisibleAssetSummaryCollections> {
  const providerInput = createAgentBuilderVisibleAssetProviderInput({
    bindings: options.bindings,
    draftYaml: options.draftYaml,
    organizationId: options.organizationId,
    viewer: options.viewer,
  });
  const collectSummaries = options.collectSummaries ?? collectAgentBuilderVisibleAssetSummaries;

  return collectSummaries(providerInput);
}
