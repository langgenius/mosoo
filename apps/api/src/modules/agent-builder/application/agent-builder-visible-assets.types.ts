import type {
  AgentBuilderVisibleAssetBindingState,
  AgentBuilderVisibleAssetChangeSet,
  AgentBuilderVisibleAssetIndexEntry,
  AgentBuilderVisibleAssetKind,
  AgentBuilderVisibleAssetsContext,
  AgentBuilderVisibleEnvironmentSummary,
  AgentBuilderVisibleMcpServerSummary,
  AgentBuilderVisibleSkillSummary,
} from "@mosoo/contracts/agent-builder";
import type { McpServerId, AppId, SkillId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { AgentBuilderLightweightPlannerDraftContext } from "./agent-builder-lightweight-draft-types";
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
  draft: AgentBuilderLightweightPlannerDraftContext;
  appId: AppId;
  viewer: AuthenticatedViewer;
}

export interface AgentBuilderVisibleAssetSummaryCollections {
  environments: AgentBuilderVisibleEnvironmentSummary[];
  mcpServers: AgentBuilderVisibleMcpServerSummary[];
  skills: AgentBuilderVisibleSkillSummary[];
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
