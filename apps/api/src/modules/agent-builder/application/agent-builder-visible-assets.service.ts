import type {
  AgentBuilderPlannerDraftBindingsContext,
  AgentBuilderVisibleAssetsContext,
} from "@mosoo/contracts/agent-builder";
import type { OrganizationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { parseAgentBuilderPlannerDraft } from "./agent-builder-draft-parser";
import {
  createVisibleAssetChanges,
  createVisibleAssetCurrentIndex,
  emptyVisibleAssetIndex,
  emptyVisibleAssetChanges,
} from "./agent-builder-visible-asset-index";
import { hashRecord } from "./agent-builder-visible-asset-model";
import { collectAgentBuilderVisibleAssetSummaries } from "./agent-builder-visible-asset-summaries";
import type {
  AgentBuilderVisibleAssetProviderInput,
  AgentBuilderVisibleAssetSummariesCollector,
  AgentBuilderParsedDraftContext,
} from "./agent-builder-visible-assets.types";

function toDraftBindings(
  draft: AgentBuilderParsedDraftContext,
): AgentBuilderPlannerDraftBindingsContext {
  return {
    channelIds: draft.channelIds,
    environmentId: draft.environmentId,
    mcpServerIds: draft.mcpServerIds,
    parseError: draft.parseError,
    parseStatus: draft.parseStatus,
    skillIds: draft.skillIds,
    spaceIds: draft.spaceIds,
  };
}

export function createAgentBuilderVisibleAssetProviderInput(input: {
  bindings: ApiBindings;
  draftYaml: string;
  organizationId: OrganizationId;
  viewer: AuthenticatedViewer;
}): AgentBuilderVisibleAssetProviderInput {
  const draftBindings = parseAgentBuilderPlannerDraft(input.draftYaml);

  return {
    bindings: input.bindings,
    boundMcpServerIds: new Set(draftBindings.mcpServerIds),
    boundSkillIds: new Set(draftBindings.skillIds),
    boundSpaceIds: new Set(draftBindings.spaceIds),
    draft: draftBindings,
    organizationId: input.organizationId,
    viewer: input.viewer,
  };
}

export async function collectAgentBuilderVisibleAssets(input: {
  bindings: ApiBindings;
  collectSummaries?: AgentBuilderVisibleAssetSummariesCollector;
  draftYaml: string;
  organizationId: OrganizationId;
  previousAssets: AgentBuilderVisibleAssetsContext | null;
  viewer: AuthenticatedViewer;
}): Promise<AgentBuilderVisibleAssetsContext> {
  const providerInput = createAgentBuilderVisibleAssetProviderInput({
    bindings: input.bindings,
    draftYaml: input.draftYaml,
    organizationId: input.organizationId,
    viewer: input.viewer,
  });
  const collectSummaries = input.collectSummaries ?? collectAgentBuilderVisibleAssetSummaries;
  const summaries = await collectSummaries(providerInput);
  const currentIndex = createVisibleAssetCurrentIndex(summaries);
  const previousIndex = input.previousAssets?.currentIndex ?? emptyVisibleAssetIndex();
  const draftBindings = providerInput.draft;

  return {
    changesSinceLastTurn:
      input.previousAssets === null
        ? emptyVisibleAssetChanges()
        : createVisibleAssetChanges(summaries, previousIndex),
    currentIndex,
    draftBindings: toDraftBindings(draftBindings),
    observedAt: toIsoString(currentTimestampMs()),
    snapshotHash: hashRecord(currentIndex),
  };
}
