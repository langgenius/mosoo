import type { AgentKind, AgentStatus } from "@mosoo/contracts/agent";
import {
  AGENT_BUILDER_PLANNER_RESPONSE_MODE_VALUES,
  parseAgentBuilderPlannerOutputJson,
} from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderPlanNode,
  AgentBuilderPlannerBoundaryPolicy,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerConversationMessage,
  AgentBuilderPlannerTurnInputKind,
} from "@mosoo/contracts/agent-builder";
import { agentBuilderMessagesTable, agentBuilderPlannerRunsTable } from "@mosoo/db";
import type {
  AccountId,
  AgentBuilderMessageId,
  AgentBuilderPlannerRunId,
  AgentBuilderThreadId,
  AgentId,
  OrganizationId,
} from "@mosoo/id";
import { desc, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getSystemAgentModel } from "../../users/application/viewer-context.service";
import { collectAgentBuilderReadinessContext } from "./agent-builder-readiness-context.service";
import { readVisibleAssetsFromPlannerContextJson } from "./agent-builder-visible-asset-index";
import { collectAgentBuilderVisibleAssets } from "./agent-builder-visible-assets.service";

const RECENT_MESSAGE_LIMIT = 12;
const HISTORICAL_RUN_LIMIT = 8;
const HISTORICAL_NODE_LIMIT = 20;

export interface AgentBuilderPlannerContextAgent {
  id: AgentId;
  kind: AgentKind;
  organizationId: OrganizationId;
  ownerId: AccountId;
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

async function listRecentConversationMessages(
  database: D1Database,
  threadId: AgentBuilderThreadId,
): Promise<AgentBuilderPlannerConversationMessage[]> {
  const rows = await getAppDatabase(database)
    .select({
      contentText: agentBuilderMessagesTable.contentText,
      role: agentBuilderMessagesTable.role,
      seq: agentBuilderMessagesTable.seq,
    })
    .from(agentBuilderMessagesTable)
    .where(eq(agentBuilderMessagesTable.threadId, threadId))
    .orderBy(desc(agentBuilderMessagesTable.seq))
    .limit(RECENT_MESSAGE_LIMIT)
    .all();

  return rows.toReversed().map((row) => ({
    contentText: row.contentText,
    role: row.role,
    seq: row.seq,
  }));
}

async function listHistoricalOpenNodes(
  database: D1Database,
  threadId: AgentBuilderThreadId,
): Promise<AgentBuilderPlanNode[]> {
  const rows = await getAppDatabase(database)
    .select({
      outputJson: agentBuilderPlannerRunsTable.outputJson,
    })
    .from(agentBuilderPlannerRunsTable)
    .where(eq(agentBuilderPlannerRunsTable.threadId, threadId))
    .orderBy(desc(agentBuilderPlannerRunsTable.createdAt), desc(agentBuilderPlannerRunsTable.id))
    .limit(HISTORICAL_RUN_LIMIT)
    .all();

  const nodes: AgentBuilderPlanNode[] = [];

  for (const row of rows) {
    if (row.outputJson === null) {
      continue;
    }

    const output = parseAgentBuilderPlannerOutputJson(row.outputJson);

    if (output === null) {
      continue;
    }

    nodes.push(...output.nodes.filter((node) => node.status !== "applied"));

    if (nodes.length >= HISTORICAL_NODE_LIMIT) {
      return nodes.slice(0, HISTORICAL_NODE_LIMIT);
    }
  }

  return nodes;
}

async function getPreviousPlannerRunContextJson(
  database: D1Database,
  threadId: AgentBuilderThreadId,
): Promise<string | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        contextJson: agentBuilderPlannerRunsTable.contextJson,
      })
      .from(agentBuilderPlannerRunsTable)
      .where(eq(agentBuilderPlannerRunsTable.threadId, threadId))
      .orderBy(desc(agentBuilderPlannerRunsTable.createdAt), desc(agentBuilderPlannerRunsTable.id))
      .limit(1)
      .get()) ?? null;

  return row?.contextJson ?? null;
}

export async function createAgentBuilderPlannerContext(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agent: AgentBuilderPlannerContextAgent;
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
  const [recentMessages, historicalOpenNodes, previousContextJson, systemAgentModel] =
    await Promise.all([
      listRecentConversationMessages(bindings.DB, input.threadId),
      listHistoricalOpenNodes(bindings.DB, input.threadId),
      getPreviousPlannerRunContextJson(bindings.DB, input.threadId),
      getSystemAgentModel(bindings.DB, viewer.id),
    ]);
  const [assets, readiness] = await Promise.all([
    collectAgentBuilderVisibleAssets({
      bindings,
      draftYaml: input.draftYaml,
      organizationId: agent.organizationId,
      previousAssets: readVisibleAssetsFromPlannerContextJson(previousContextJson),
      viewer,
    }),
    collectAgentBuilderReadinessContext(bindings, {
      agent: {
        id: agent.id,
        organizationId: agent.organizationId,
        ownerId: agent.ownerId,
      },
      draftYaml: input.draftYaml,
    }),
  ]);

  return {
    agent: {
      agentId: agent.id,
      kind: agent.kind,
      organizationId: agent.organizationId,
      status: agent.status,
    },
    assets,
    boundaryPolicy: AGENT_BUILDER_BOUNDARY_POLICY,
    conversation: {
      recentMessages,
    },
    draft: {
      revision: input.draftRevision,
      yaml: input.draftYaml,
    },
    historicalOpenNodes,
    plannerRunId: input.plannerRunId,
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
