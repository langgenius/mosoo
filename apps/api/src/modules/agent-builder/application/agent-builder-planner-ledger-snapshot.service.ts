import type {
  AgentBuilderPlanNode,
  AgentBuilderPlannerMemoryDiagnostic,
  AgentBuilderPlannerConversationMessage,
  AgentBuilderPreviousVisibleAssetsContext,
  AgentBuilderVisibleAssetsContext,
} from "@mosoo/contracts/agent-builder";
import { parseAgentBuilderPlannerOutputJson } from "@mosoo/contracts/agent-builder";
import { agentBuilderMessagesTable, agentBuilderPlannerRunsTable } from "@mosoo/db";
import type { AgentBuilderPlannerRunStatus } from "@mosoo/db";
import type { AgentBuilderPlannerRunId, AgentBuilderThreadId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { readPreviousVisibleAssetsFromPlannerContextJson } from "./agent-builder-previous-visible-assets";
import { parseAgentBuilderStructuredReply } from "./agent-builder-structured-input";

const RECENT_MESSAGE_LIMIT = 12;
const HISTORICAL_RUN_LIMIT = 8;
const HISTORICAL_NODE_LIMIT = 20;

export interface AgentBuilderPlannerPreviousVisibleAssetsSnapshot {
  assets: AgentBuilderVisibleAssetsContext | null;
  context: AgentBuilderPreviousVisibleAssetsContext;
}

export interface AgentBuilderPlannerLedgerSnapshot {
  diagnostics: AgentBuilderPlannerMemoryDiagnostic[];
  historicalOpenNodes: AgentBuilderPlanNode[];
  previousVisibleAssets: AgentBuilderPlannerPreviousVisibleAssetsSnapshot;
  recentMessages: AgentBuilderPlannerConversationMessage[];
}

interface AgentBuilderPlannerRunLedgerRow {
  contextJson: string | null;
  createdAt: number;
  id: AgentBuilderPlannerRunId;
  outputJson: string | null;
  status: AgentBuilderPlannerRunStatus;
  triggerMessageSeq: number | null;
}

interface AgentBuilderQuestionAnswerLedgerRow {
  nodeKey: string;
  seq: number;
}

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

async function listRecentPlannerRuns(
  database: D1Database,
  threadId: AgentBuilderThreadId,
): Promise<AgentBuilderPlannerRunLedgerRow[]> {
  return getAppDatabase(database)
    .select({
      contextJson: agentBuilderPlannerRunsTable.contextJson,
      createdAt: agentBuilderPlannerRunsTable.createdAt,
      id: agentBuilderPlannerRunsTable.id,
      outputJson: agentBuilderPlannerRunsTable.outputJson,
      status: agentBuilderPlannerRunsTable.status,
      triggerMessageSeq: agentBuilderMessagesTable.seq,
    })
    .from(agentBuilderPlannerRunsTable)
    .leftJoin(
      agentBuilderMessagesTable,
      eq(agentBuilderPlannerRunsTable.triggerMessageId, agentBuilderMessagesTable.id),
    )
    .where(eq(agentBuilderPlannerRunsTable.threadId, threadId))
    .orderBy(
      desc(agentBuilderMessagesTable.seq),
      desc(agentBuilderPlannerRunsTable.createdAt),
      desc(agentBuilderPlannerRunsTable.id),
    )
    .limit(HISTORICAL_RUN_LIMIT)
    .all();
}

async function listRecentQuestionAnswers(
  database: D1Database,
  threadId: AgentBuilderThreadId,
): Promise<AgentBuilderQuestionAnswerLedgerRow[]> {
  const rows = await getAppDatabase(database)
    .select({
      contentText: agentBuilderMessagesTable.contentText,
      seq: agentBuilderMessagesTable.seq,
    })
    .from(agentBuilderMessagesTable)
    .where(
      and(
        eq(agentBuilderMessagesTable.threadId, threadId),
        eq(agentBuilderMessagesTable.inputKind, "question_answer"),
      ),
    )
    .orderBy(desc(agentBuilderMessagesTable.seq))
    .limit(RECENT_MESSAGE_LIMIT)
    .all();

  return rows.flatMap((row) => {
    const reply = parseAgentBuilderStructuredReply(row.contentText);

    return reply === null ? [] : [{ nodeKey: reply.nodeKey, seq: row.seq }];
  });
}

function wasQuestionAnsweredAfterPlannerRun(input: {
  readonly answers: readonly AgentBuilderQuestionAnswerLedgerRow[];
  readonly node: AgentBuilderPlanNode;
  readonly plannerRunTriggerMessageSeq: number | null;
}): boolean {
  if (input.plannerRunTriggerMessageSeq === null) {
    return false;
  }

  const triggerMessageSeq = input.plannerRunTriggerMessageSeq;

  return (
    input.node.kind === "question" &&
    input.answers.some(
      (answer) => answer.nodeKey === input.node.nodeKey && answer.seq > triggerMessageSeq,
    )
  );
}

function readHistoricalPendingNodesFromPlannerRuns(
  rows: readonly AgentBuilderPlannerRunLedgerRow[],
  answers: readonly AgentBuilderQuestionAnswerLedgerRow[],
): {
  diagnostics: AgentBuilderPlannerMemoryDiagnostic[];
  nodes: AgentBuilderPlanNode[];
} {
  const nodes: AgentBuilderPlanNode[] = [];
  const diagnostics: AgentBuilderPlannerMemoryDiagnostic[] = [];

  for (const row of rows) {
    if (row.status !== "completed") {
      continue;
    }

    if (row.outputJson === null) {
      diagnostics.push({
        code: "invalid_planner_output",
        message: "A completed Agent Builder planner run is missing output JSON.",
        plannerRunId: row.id,
        severity: "warning",
      });
      break;
    }

    const output = parseAgentBuilderPlannerOutputJson(row.outputJson);

    if (output === null) {
      diagnostics.push({
        code: "invalid_planner_output",
        message: "A completed Agent Builder planner run contains invalid output JSON.",
        plannerRunId: row.id,
        severity: "warning",
      });
      break;
    }

    nodes.push(
      ...output.nodes.filter(
        (node) =>
          node.status === "pending" &&
          !wasQuestionAnsweredAfterPlannerRun({
            answers,
            node,
            plannerRunTriggerMessageSeq: row.triggerMessageSeq,
          }),
      ),
    );

    if (nodes.length >= HISTORICAL_NODE_LIMIT) {
      return {
        diagnostics,
        nodes: nodes.slice(0, HISTORICAL_NODE_LIMIT),
      };
    }
  }

  return {
    diagnostics,
    nodes,
  };
}

export async function readAgentBuilderPlannerLedgerSnapshot(
  database: D1Database,
  threadId: AgentBuilderThreadId,
): Promise<AgentBuilderPlannerLedgerSnapshot> {
  const [recentMessages, plannerRuns, questionAnswers] = await Promise.all([
    listRecentConversationMessages(database, threadId),
    listRecentPlannerRuns(database, threadId),
    listRecentQuestionAnswers(database, threadId),
  ]);
  const plannerRunMemory = readHistoricalPendingNodesFromPlannerRuns(plannerRuns, questionAnswers);

  return {
    diagnostics: plannerRunMemory.diagnostics,
    historicalOpenNodes: plannerRunMemory.nodes,
    previousVisibleAssets: readPreviousVisibleAssetsFromPlannerContextJson(
      plannerRuns[0]?.contextJson ?? null,
    ),
    recentMessages,
  };
}
