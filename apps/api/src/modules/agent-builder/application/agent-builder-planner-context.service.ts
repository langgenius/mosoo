import type { AgentKind, AgentStatus } from "@mosoo/contracts/agent";
import { AGENT_BUILDER_PLANNER_RESPONSE_MODE_VALUES } from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderPlannerBoundaryPolicy,
  AgentBuilderPlannerContext,
  AgentBuilderPreviewStageSnapshot,
  AgentBuilderPlannerTurnInputKind,
} from "@mosoo/contracts/agent-builder";
import type {
  AccountId,
  AgentBuilderMessageId,
  AgentBuilderPlannerRunId,
  AgentBuilderThreadId,
  AgentId,
  AppId,
  OrganizationId,
} from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getSystemAgentModel } from "../../users/application/viewer-context.service";
import type { AgentBuilderLightweightPlannerDraftContext } from "./agent-builder-lightweight-draft-types";
import { toAgentBuilderPlannerDraftContext } from "./agent-builder-lightweight-manifest-projections";
import { readAgentBuilderPlannerLedgerSnapshot } from "./agent-builder-planner-ledger-snapshot.service";
import {
  readAgentBuilderPreviewOpenedAt,
  readLatestAgentBuilderPreviewSession,
  toAgentBuilderPreviewStageSnapshot,
} from "./agent-builder-preview-session.service";
import { collectAgentBuilderReadinessContext } from "./agent-builder-readiness-context.service";
import { collectAgentBuilderVisibleAssets } from "./agent-builder-visible-assets.service";

export interface AgentBuilderPlannerContextSourceAgent {
  description: string | null;
  id: AgentId;
  kind: AgentKind;
  model: string;
  name: string;
  ownerId: AccountId;
  prompt: string;
  appOrganizationId: OrganizationId;
  appId: AppId;
  provider: string;
  runtimeId: string;
  status: AgentStatus;
}

const AGENT_BUILDER_BOUNDARY_POLICY = {
  allowedModes: [...AGENT_BUILDER_PLANNER_RESPONSE_MODE_VALUES],
  forbiddenWrites: [
    "secret_plaintext",
    "provider_key",
    "collaborator_permission",
    "publish_state",
    "terminal_command_to_draft",
    "other_agent_draft",
    "production_runtime_state",
  ],
  requiresLlmPlanner: true,
} satisfies AgentBuilderPlannerBoundaryPolicy;

async function readPreviewStageSnapshot(
  database: D1Database,
  input: {
    readonly agent: AgentBuilderPlannerContextSourceAgent;
    readonly threadId: AgentBuilderThreadId;
    readonly viewerId: AccountId;
  },
): Promise<AgentBuilderPreviewStageSnapshot> {
  const [previewOpenedAt, session] = await Promise.all([
    readAgentBuilderPreviewOpenedAt(database, input.threadId),
    readLatestAgentBuilderPreviewSession(database, input),
  ]);

  return toAgentBuilderPreviewStageSnapshot({ previewOpenedAt, session });
}

function isAgentBuilderBaseConfigApplied(input: {
  readonly agent: AgentBuilderPlannerContextSourceAgent;
  readonly draft: AgentBuilderLightweightPlannerDraftContext;
}): boolean {
  return (
    input.draft.parseStatus === "parsed" &&
    input.draft.kind !== null &&
    input.draft.name !== null &&
    input.draft.description !== null &&
    input.draft.runtimeId !== null &&
    input.draft.provider !== null &&
    input.draft.model !== null &&
    input.draft.prompt !== null &&
    input.agent.kind === input.draft.kind &&
    input.agent.name === input.draft.name &&
    input.agent.description === input.draft.description &&
    input.agent.runtimeId === input.draft.runtimeId &&
    input.agent.provider === input.draft.provider &&
    input.agent.model === input.draft.model &&
    input.agent.prompt === input.draft.prompt
  );
}

export async function createAgentBuilderPlannerContext(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agent: AgentBuilderPlannerContextSourceAgent;
    draftRevision: string;
    draftYaml: string;
    inputKind: AgentBuilderPlannerTurnInputKind;
    inputText: string;
    plannerRunId: AgentBuilderPlannerRunId;
    threadId: AgentBuilderThreadId;
    triggerMessageId: AgentBuilderMessageId;
  },
): Promise<AgentBuilderPlannerContext> {
  const agent = input.agent;
  const draftContext = toAgentBuilderPlannerDraftContext(input.draftYaml);
  const [ledger, preview, systemAgentModel] = await Promise.all([
    readAgentBuilderPlannerLedgerSnapshot(bindings.DB, input.threadId),
    readPreviewStageSnapshot(bindings.DB, {
      agent,
      threadId: input.threadId,
      viewerId: viewer.id,
    }),
    getSystemAgentModel(bindings.DB, viewer.id),
  ]);
  const [assets, readiness] = await Promise.all([
    collectAgentBuilderVisibleAssets({
      bindings,
      draft: draftContext,
      organizationId: agent.appOrganizationId,
      previousAssets: ledger.previousVisibleAssets.assets,
      previousContext: ledger.previousVisibleAssets.context,
      appId: agent.appId,
      viewer,
    }),
    collectAgentBuilderReadinessContext(bindings, {
      agent: {
        id: agent.id,
        appOrganizationId: agent.appOrganizationId,
        ownerId: agent.ownerId,
        appId: agent.appId,
      },
      draft: draftContext,
    }),
  ]);

  return {
    agent: {
      agentId: agent.id,
      baseConfigApplied: isAgentBuilderBaseConfigApplied({
        agent,
        draft: draftContext,
      }),
      kind: agent.kind,
      organizationId: agent.appOrganizationId,
      appId: agent.appId,
      status: agent.status,
    },
    assets,
    boundaryPolicy: AGENT_BUILDER_BOUNDARY_POLICY,
    conversation: {
      recentMessages: ledger.recentMessages,
    },
    draft: {
      revision: input.draftRevision,
      yaml: input.draftYaml,
    },
    historicalOpenNodes: ledger.historicalOpenNodes,
    memory: {
      diagnostics: ledger.diagnostics,
    },
    plannerRunId: input.plannerRunId,
    preview,
    readiness,
    systemAgent: {
      credentialSource: "provider_database",
      model:
        systemAgentModel === null
          ? null
          : {
              modelId: systemAgentModel.modelId,
              provider: systemAgentModel.vendor,
            },
    },
    threadId: input.threadId,
    turn: {
      inputKind: input.inputKind,
      inputText: input.inputText,
      triggerMessageId: input.triggerMessageId,
    },
    version: 1,
  };
}
