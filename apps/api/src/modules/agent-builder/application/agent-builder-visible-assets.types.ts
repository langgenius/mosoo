import type {
  AgentBuilderPlannerDraftBindingsContext,
  AgentBuilderSelectedSpaceFilesSummary,
  AgentBuilderVisibleAssetBindingState,
  AgentBuilderVisibleAssetChangeSet,
  AgentBuilderVisibleAssetIndexEntry,
  AgentBuilderVisibleAssetKind,
  AgentBuilderVisibleAssetsContext,
  AgentBuilderVisibleChannelSummary,
  AgentBuilderVisibleEnvironmentSummary,
  AgentBuilderVisibleMcpServerSummary,
  AgentBuilderVisibleSkillSummary,
  AgentBuilderVisibleSpaceSummary,
} from "@mosoo/contracts/agent-builder";
import type { McpServerId, OrganizationId, SkillId, SpaceId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";

export interface DraftSpaceBinding {
  id: SpaceId;
  name: string;
}

export interface AgentBuilderParsedDraftContext extends AgentBuilderPlannerDraftBindingsContext {
  description: string | null;
  mcpServersRepresented: boolean;
  model: string | null;
  name: string | null;
  prompt: string | null;
  provider: string | null;
  runtimeId: string | null;
  spaces: DraftSpaceBinding[];
}

export interface HashableAssetSummary {
  bindingState: AgentBuilderVisibleAssetBindingState;
  hash: string;
  id: string;
  name: string;
}

export type VisibleAssetCurrentIndex = AgentBuilderVisibleAssetsContext["currentIndex"];
export type VisibleAssetChangesSinceLastTurn =
  AgentBuilderVisibleAssetsContext["changesSinceLastTurn"];

export interface AgentBuilderVisibleAssetProviderInput {
  bindings: ApiBindings;
  boundMcpServerIds: ReadonlySet<McpServerId>;
  boundSkillIds: ReadonlySet<SkillId>;
  boundSpaceIds: ReadonlySet<SpaceId>;
  draft: AgentBuilderParsedDraftContext;
  organizationId: OrganizationId;
  viewer: AuthenticatedViewer;
}

export interface AgentBuilderVisibleAssetSummaryCollections {
  channels: AgentBuilderVisibleChannelSummary[];
  environments: AgentBuilderVisibleEnvironmentSummary[];
  mcpServers: AgentBuilderVisibleMcpServerSummary[];
  selectedSpaceFiles: AgentBuilderSelectedSpaceFilesSummary[];
  skills: AgentBuilderVisibleSkillSummary[];
  spaces: AgentBuilderVisibleSpaceSummary[];
}

export type AgentBuilderVisibleAssetSummariesCollector = (
  input: AgentBuilderVisibleAssetProviderInput,
) => Promise<AgentBuilderVisibleAssetSummaryCollections>;

export type VisibleAssetKindByCollection = Record<
  keyof AgentBuilderVisibleAssetSummaryCollections,
  AgentBuilderVisibleAssetKind
>;

export type VisibleAssetChangeSet<TAsset extends HashableAssetSummary> =
  AgentBuilderVisibleAssetChangeSet<TAsset>;

export type VisibleAssetIndexEntry = AgentBuilderVisibleAssetIndexEntry;
