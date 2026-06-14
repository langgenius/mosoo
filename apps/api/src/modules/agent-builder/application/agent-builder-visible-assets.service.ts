import type {
  AgentBuilderPlannerDraftBindingsContext,
  AgentBuilderPreviousVisibleAssetsContext,
  AgentBuilderVisibleAssetsContext,
} from "@mosoo/contracts/agent-builder";
import type { AppId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { AgentBuilderLightweightPlannerDraftContext } from "./agent-builder-lightweight-draft-types";
import type { AgentBuilderPlannerDraftInput } from "./agent-builder-planner-draft-input";
import { resolveAgentBuilderPlannerDraftInput } from "./agent-builder-planner-draft-input";
import {
  availablePreviousVisibleAssetsContext,
  missingPreviousVisibleAssetsContext,
} from "./agent-builder-previous-visible-assets";
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
} from "./agent-builder-visible-assets.types";

function toDraftBindings(
  draft: AgentBuilderLightweightPlannerDraftContext,
): AgentBuilderPlannerDraftBindingsContext {
  return {
    componentDecisions: draft.componentDecisions,
    environmentId: draft.environmentId,
    mcpServerIds: draft.mcpServerIds,
    parseError: draft.parseError,
    parseStatus: draft.parseStatus,
    skillIds: draft.skillIds,
    spaceIds: draft.spaceIds,
  };
}

function resolvePreviousContext(input: {
  previousAssets: AgentBuilderVisibleAssetsContext | null;
  previousContext?: AgentBuilderPreviousVisibleAssetsContext | undefined;
}): AgentBuilderPreviousVisibleAssetsContext {
  if (input.previousContext !== undefined) {
    return input.previousContext;
  }

  return input.previousAssets === null
    ? missingPreviousVisibleAssetsContext()
    : availablePreviousVisibleAssetsContext();
}

export function createAgentBuilderVisibleAssetProviderInput(
  input: {
    bindings: ApiBindings;
    appId: AppId;
    viewer: AuthenticatedViewer;
  } & AgentBuilderPlannerDraftInput,
): AgentBuilderVisibleAssetProviderInput {
  const draftBindings = resolveAgentBuilderPlannerDraftInput(input);

  return {
    bindings: input.bindings,
    boundMcpServerIds: new Set(draftBindings.mcpServerIds),
    boundSkillIds: new Set(draftBindings.skillIds),
    boundSpaceIds: new Set(draftBindings.spaceIds),
    draft: draftBindings,
    appId: input.appId,
    viewer: input.viewer,
  };
}

export async function collectAgentBuilderVisibleAssets(
  input: {
    bindings: ApiBindings;
    collectSummaries?: AgentBuilderVisibleAssetSummariesCollector;
    previousAssets: AgentBuilderVisibleAssetsContext | null;
    previousContext?: AgentBuilderPreviousVisibleAssetsContext | undefined;
    appId: AppId;
    viewer: AuthenticatedViewer;
  } & AgentBuilderPlannerDraftInput,
): Promise<AgentBuilderVisibleAssetsContext> {
  const draftBindings = resolveAgentBuilderPlannerDraftInput(input);
  const previousContext = resolvePreviousContext(input);

  if (draftBindings.parseStatus === "failed") {
    const currentIndex = emptyVisibleAssetIndex();

    return {
      changesSinceLastTurn: emptyVisibleAssetChanges(),
      currentIndex,
      draftBindings: toDraftBindings(draftBindings),
      observedAt: toIsoString(currentTimestampMs()),
      previousContext,
      snapshotHash: hashRecord(currentIndex),
    };
  }

  const providerInput = createAgentBuilderVisibleAssetProviderInput({
    bindings: input.bindings,
    draft: draftBindings,
    appId: input.appId,
    viewer: input.viewer,
  });
  const collectSummaries = input.collectSummaries ?? collectAgentBuilderVisibleAssetSummaries;
  const summaries = await collectSummaries(providerInput);
  const currentIndex = createVisibleAssetCurrentIndex(summaries);
  const previousIndex =
    previousContext.status === "available"
      ? (input.previousAssets?.currentIndex ?? emptyVisibleAssetIndex())
      : emptyVisibleAssetIndex();

  return {
    changesSinceLastTurn:
      previousContext.status !== "available" || input.previousAssets === null
        ? emptyVisibleAssetChanges()
        : createVisibleAssetChanges(summaries, previousIndex),
    currentIndex,
    draftBindings: toDraftBindings(draftBindings),
    observedAt: toIsoString(currentTimestampMs()),
    previousContext,
    snapshotHash: hashRecord(currentIndex),
  };
}
