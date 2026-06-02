import type {
  AgentBuilderPlannerContext,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";
import type { AccountId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createAgentBuilderToolRuntime } from "./agent-builder-tool-runtime.service";
import type {
  AgentBuilderToolDefinition,
  AgentBuilderToolRuntime,
} from "./agent-builder-tool-runtime.service";
import { createDryRunDraftPatchTool } from "./tools/dry-run-draft-patch.tool";
import { createGetAssetDetailTool } from "./tools/get-asset-detail.tool";
import { createGetDraftSnapshotTool } from "./tools/get-draft-snapshot.tool";
import { createAskUserTool, createReturnBlockedTool } from "./tools/interaction-tools.tool";
import {
  createPrepareBindEnvironmentPatchTool,
  createPrepareBindMcpPatchTool,
  createPrepareBindSkillPatchTool,
  createPrepareBindSpacePatchTool,
  createPrepareReplaceSkillPatchTool,
} from "./tools/prepare-bind-asset-patch.tool";
import { createPrepareDraftPatchTool } from "./tools/prepare-draft-patch.tool";
import { createResolveAssetReferenceTool } from "./tools/resolve-asset-reference.tool";
import { createSearchAssetsTool } from "./tools/search-assets.tool";

export interface AgentBuilderPlannerToolRuntimeOptions {
  actorAccountId: AccountId;
  bindings: ApiBindings;
  context: AgentBuilderPlannerContext;
  viewer: AuthenticatedViewer;
}

function createContextBoundDraftSnapshotTool(
  context: AgentBuilderPlannerContext,
): AgentBuilderToolDefinition {
  const tool = createGetDraftSnapshotTool();

  return {
    ...tool,
    execute(
      input: AgentBuilderToolPayload,
    ): AgentBuilderToolPayload | Promise<AgentBuilderToolPayload> {
      return tool.execute({
        ...input,
        draftRevision: context.draft.revision,
        draftYaml: context.draft.yaml,
      });
    },
  };
}

export function createAgentBuilderPlannerToolRuntime(
  options: AgentBuilderPlannerToolRuntimeOptions,
): AgentBuilderToolRuntime {
  return createAgentBuilderToolRuntime({
    tools: [
      createContextBoundDraftSnapshotTool(options.context),
      createSearchAssetsTool({
        bindings: options.bindings,
        draftYaml: options.context.draft.yaml,
        organizationId: options.context.agent.organizationId,
        viewer: options.viewer,
      }),
      createGetAssetDetailTool({
        bindings: options.bindings,
        draftYaml: options.context.draft.yaml,
        organizationId: options.context.agent.organizationId,
        viewer: options.viewer,
      }),
      createResolveAssetReferenceTool({
        bindings: options.bindings,
        context: options.context,
        draftYaml: options.context.draft.yaml,
        organizationId: options.context.agent.organizationId,
        viewer: options.viewer,
      }),
      createPrepareDraftPatchTool({
        actorAccountId: options.actorAccountId,
        bindings: options.bindings,
        context: options.context,
      }),
      createDryRunDraftPatchTool({
        bindings: options.bindings,
        context: options.context,
        viewer: options.viewer,
      }),
      createPrepareBindSpacePatchTool({
        actorAccountId: options.actorAccountId,
        bindings: options.bindings,
        context: options.context,
      }),
      createPrepareBindEnvironmentPatchTool({
        actorAccountId: options.actorAccountId,
        bindings: options.bindings,
        context: options.context,
      }),
      createPrepareBindMcpPatchTool({
        actorAccountId: options.actorAccountId,
        bindings: options.bindings,
        context: options.context,
      }),
      createPrepareBindSkillPatchTool({
        actorAccountId: options.actorAccountId,
        bindings: options.bindings,
        context: options.context,
      }),
      createPrepareReplaceSkillPatchTool({
        actorAccountId: options.actorAccountId,
        bindings: options.bindings,
        context: options.context,
      }),
      createAskUserTool({
        context: options.context,
      }),
      createReturnBlockedTool({
        context: options.context,
      }),
    ],
  });
}
