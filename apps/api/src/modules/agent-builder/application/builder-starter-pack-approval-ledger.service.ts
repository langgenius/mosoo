import {
  normalizeAgentBuilderApprovalNodeKey,
  parseAgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderPlanNode,
  AgentBuilderPlannerOutput,
  AgentBuilderStarterPackItem,
  AgentBuilderStarterPackResult,
  AgentBuilderToolExecutionRecord,
} from "@mosoo/contracts/agent-builder";
import {
  agentBuilderMessagesTable,
  agentBuilderPlannerRunsTable,
  agentBuilderThreadsTable,
} from "@mosoo/db";
import type { AgentBuilderPlannerRunRow } from "@mosoo/db";
import type { AgentBuilderPlannerRunId, AgentBuilderThreadId, AgentId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createAgentBuilderMessageId } from "./agent-builder-ids";
import {
  allocateAgentBuilderMessageSeq,
  getAgentBuilderThreadRowByAgentId,
  toAgentBuilderMessageModel,
} from "./agent-builder-thread.service";
import type { AgentBuilderMessageModel } from "./agent-builder-thread.service";
import { prepareAgentBuilderStarterPackApproval } from "./builder-starter-pack-approval.service";
import type { AgentBuilderStarterPackApprovalRequest } from "./builder-starter-pack-approval.service";

async function getPlannerRunForConfirmation(input: {
  database: D1Database;
  plannerRunId: AgentBuilderPlannerRunId;
  threadId: AgentBuilderThreadId;
}): Promise<AgentBuilderPlannerRunRow> {
  const row =
    (await getAppDatabase(input.database)
      .select()
      .from(agentBuilderPlannerRunsTable)
      .where(
        and(
          eq(agentBuilderPlannerRunsTable.id, input.plannerRunId),
          eq(agentBuilderPlannerRunsTable.threadId, input.threadId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw new Error("Agent Builder planner run was not found for confirmation.");
  }

  return row;
}

function readStarterPackResultForApproval(
  row: AgentBuilderPlannerRunRow,
): AgentBuilderStarterPackResult {
  if (row.outputJson === null) {
    throw new Error("Agent Builder planner run has no Starter Pack output to approve.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(row.outputJson);
  } catch {
    throw new Error("Agent Builder Starter Pack output is invalid JSON.");
  }

  const result = parseAgentBuilderStarterPackResult(parsed);

  if (result === null) {
    throw new Error("Agent Builder planner run output is not a valid Starter Pack.");
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isToolExecutionRecord(value: unknown): value is AgentBuilderToolExecutionRecord {
  return (
    isRecord(value) &&
    typeof value["requestedToolId"] === "string" &&
    (typeof value["toolId"] === "string" || value["toolId"] === null) &&
    (value["status"] === "blocked" ||
      value["status"] === "completed" ||
      value["status"] === "failed") &&
    isRecord(value["input"]) &&
    (isRecord(value["output"]) || value["output"] === null)
  );
}

function readStarterPackApprovalTrace(
  row: AgentBuilderPlannerRunRow,
): AgentBuilderToolExecutionRecord[] {
  if (row.toolTraceJson === null) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(row.toolTraceJson);
  } catch {
    return [];
  }

  return Array.isArray(parsed) ? parsed.filter(isToolExecutionRecord) : [];
}

function isDraftPatchPlanNode(value: unknown): value is AgentBuilderPlanNode {
  return (
    isRecord(value) &&
    value["kind"] === "draft_patch" &&
    typeof value["nodeKey"] === "string" &&
    isRecord(value["draftPatch"])
  );
}

function readDraftPatchNodesFromRecord(
  record: AgentBuilderToolExecutionRecord,
): AgentBuilderPlanNode[] {
  const nodes = record.output?.["nodes"];

  return Array.isArray(nodes) ? nodes.filter(isDraftPatchPlanNode) : [];
}

function getPrepareBindToolIdForAssetType(
  assetType: AgentBuilderStarterPackItem["assetType"],
):
  | "prepare_bind_environment_patch"
  | "prepare_bind_mcp_patch"
  | "prepare_bind_skill_patch"
  | "prepare_bind_space_patch"
  | null {
  if (assetType === "environment") {
    return "prepare_bind_environment_patch";
  }

  if (assetType === "mcp") {
    return "prepare_bind_mcp_patch";
  }

  if (assetType === "skill") {
    return "prepare_bind_skill_patch";
  }

  if (assetType === "space") {
    return "prepare_bind_space_patch";
  }

  return null;
}

function draftPatchValueContainsAssetId(value: unknown, assetId: string): boolean {
  return value === assetId || (Array.isArray(value) && value.includes(assetId));
}

function findDraftPatchNodeByNodeKey(
  trace: readonly AgentBuilderToolExecutionRecord[],
  nodeKey: string,
): AgentBuilderPlanNode | null {
  for (const record of trace) {
    if (record.status !== "completed") {
      continue;
    }

    const node = readDraftPatchNodesFromRecord(record).find(
      (candidate) => candidate.nodeKey === nodeKey && candidate.status === "applied",
    );

    if (node !== undefined) {
      return node;
    }
  }

  return null;
}

function findBindDraftPatchNodeForAsset(
  trace: readonly AgentBuilderToolExecutionRecord[],
  item: AgentBuilderStarterPackItem,
): AgentBuilderPlanNode | null {
  if (item.action.type !== "bind_existing_asset") {
    return null;
  }

  const assetId = item.action.assetId;
  const expectedToolId = getPrepareBindToolIdForAssetType(item.assetType);

  if (expectedToolId === null) {
    return null;
  }

  for (const record of trace) {
    if (record.status !== "completed" || record.toolId !== expectedToolId) {
      continue;
    }

    if (record.input["assetId"] !== assetId) {
      continue;
    }

    const node = readDraftPatchNodesFromRecord(record).find(
      (candidate) =>
        candidate.status === "applied" &&
        draftPatchValueContainsAssetId(candidate.draftPatch?.value, assetId),
    );

    if (node !== undefined) {
      return node;
    }
  }

  return null;
}

function collectStarterPackApprovalDraftPatchNodes(input: {
  approvedItems: readonly AgentBuilderStarterPackItem[];
  trace: readonly AgentBuilderToolExecutionRecord[];
}): AgentBuilderPlanNode[] {
  const nodes: AgentBuilderPlanNode[] = [];
  const seenNodeKeys = new Set<string>();

  for (const item of input.approvedItems) {
    const node =
      item.action.type === "draft_patch"
        ? findDraftPatchNodeByNodeKey(input.trace, item.action.patchNodeKey)
        : findBindDraftPatchNodeForAsset(input.trace, item);

    if (node === null || seenNodeKeys.has(node.nodeKey)) {
      continue;
    }

    nodes.push(node);
    seenNodeKeys.add(node.nodeKey);
  }

  return nodes;
}

function normalizeStarterPackApprovalRequest(input: {
  mode: "batch" | "single";
  nodeKey?: string | null;
}): AgentBuilderStarterPackApprovalRequest {
  if (input.mode === "batch") {
    return { mode: "batch" };
  }

  const nodeKey = normalizeAgentBuilderApprovalNodeKey(input.nodeKey);

  if (nodeKey === null) {
    throw new Error("Starter Pack single approval requires nodeKey.");
  }

  return {
    mode: "single",
    nodeKey,
  };
}

function markStarterPackItemsApproved(input: {
  approvedItems: readonly AgentBuilderStarterPackItem[];
  result: AgentBuilderStarterPackResult;
  skippedItems: readonly { nodeKey: string }[];
}): AgentBuilderStarterPackResult {
  const approvedNodeKeys = new Set(input.approvedItems.map((item) => item.nodeKey));
  const skippedNodeKeys = new Set(input.skippedItems.map((item) => item.nodeKey));

  return {
    ...input.result,
    items: input.result.items.map((item) => {
      if (approvedNodeKeys.has(item.nodeKey)) {
        return {
          ...item,
          status: "approved" as const,
        };
      }

      if (skippedNodeKeys.has(item.nodeKey) && item.status === "pending") {
        return {
          ...item,
          status: "skipped" as const,
        };
      }

      return item;
    }),
  };
}

function createStarterPackApprovalAssistantText(input: {
  approvedCount: number;
  patchCount?: number;
  skippedCount: number;
}): string {
  if (input.approvedCount === 0) {
    return input.skippedCount === 0
      ? "没有可确认的 Starter Pack 项。"
      : `没有确认任何 Starter Pack 项；已跳过 ${input.skippedCount} 项。`;
  }

  const patchText =
    input.patchCount === undefined || input.patchCount === 0
      ? ""
      : `，其中 ${input.patchCount} 项已准备应用到 Draft`;

  return input.skippedCount === 0
    ? `已确认 ${input.approvedCount} 项 Starter Pack${patchText}。`
    : `已确认 ${input.approvedCount} 项 Starter Pack${patchText}，跳过 ${input.skippedCount} 项。`;
}

function createStarterPackApprovalDraftPatchOutput(input: {
  assistantText: string;
  nodes: readonly AgentBuilderPlanNode[];
  plannerRunId: AgentBuilderPlannerRunId;
}): AgentBuilderPlannerOutput {
  return {
    assistantText: input.assistantText,
    intentSummary: "Apply approved Agent Starter Pack items to the current Draft.",
    mode: "draft_patch",
    nodes: [...input.nodes],
    plannerRunId: input.plannerRunId,
    version: 1,
  };
}

function createStarterPackApprovalMessageOutput(input: {
  approvalAssistantText: string;
  approvedDraftPatchNodes: readonly AgentBuilderPlanNode[];
  plannerRunId: AgentBuilderPlannerRunId;
  starterPack: AgentBuilderStarterPackResult;
}): AgentBuilderPlannerOutput | AgentBuilderStarterPackResult {
  if (input.approvedDraftPatchNodes.length > 0) {
    return createStarterPackApprovalDraftPatchOutput({
      assistantText: input.approvalAssistantText,
      nodes: input.approvedDraftPatchNodes,
      plannerRunId: input.plannerRunId,
    });
  }

  return {
    ...input.starterPack,
    assistantText: input.approvalAssistantText,
  };
}

export async function approveAgentBuilderStarterPack(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    mode: "batch" | "single";
    nodeKey?: string | null;
    plannerRunId: AgentBuilderPlannerRunId;
  },
): Promise<AgentBuilderMessageModel[]> {
  const { agent } = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);
  const thread = await getAgentBuilderThreadRowByAgentId(bindings.DB, agent.id);

  if (thread === null) {
    throw new Error("Agent Builder thread was not found.");
  }

  const plannerRun = await getPlannerRunForConfirmation({
    database: bindings.DB,
    plannerRunId: input.plannerRunId,
    threadId: thread.id,
  });
  const starterPack = readStarterPackResultForApproval(plannerRun);
  const approvalRequest = normalizeStarterPackApprovalRequest(input);
  const approvalPlan = prepareAgentBuilderStarterPackApproval(starterPack, approvalRequest);
  const updatedStarterPack = markStarterPackItemsApproved({
    approvedItems: approvalPlan.approvedItems,
    result: starterPack,
    skippedItems: approvalPlan.skippedItems,
  });
  const approvedDraftPatchNodes = collectStarterPackApprovalDraftPatchNodes({
    approvedItems: approvalPlan.approvedItems,
    trace: readStarterPackApprovalTrace(plannerRun),
  });
  const assistantText = createStarterPackApprovalAssistantText({
    approvedCount: approvalPlan.approvedItems.length,
    patchCount: approvedDraftPatchNodes.length,
    skippedCount: approvalPlan.skippedItems.length,
  });
  const updatedStarterPackJson = JSON.stringify(updatedStarterPack);
  const messageOutputJson = JSON.stringify(
    createStarterPackApprovalMessageOutput({
      approvalAssistantText: assistantText,
      approvedDraftPatchNodes,
      plannerRunId: input.plannerRunId,
      starterPack: updatedStarterPack,
    }),
  );
  const now = currentTimestampMs();
  const firstSeq = await allocateAgentBuilderMessageSeq(bindings.DB, {
    count: 1,
    threadId: thread.id,
  });
  const messageRows = [
    {
      cardsJson: messageOutputJson,
      contentText: assistantText,
      createdAt: now,
      createdByAccountId: null,
      id: createAgentBuilderMessageId(),
      inputKind: null,
      plannerRunId: input.plannerRunId,
      role: "assistant" as const,
      seq: firstSeq,
      threadId: thread.id,
    },
  ];

  await runAppDatabaseBatch(bindings.DB, (db) => [
    db
      .update(agentBuilderPlannerRunsTable)
      .set({ outputJson: updatedStarterPackJson })
      .where(
        and(
          eq(agentBuilderPlannerRunsTable.id, input.plannerRunId),
          eq(agentBuilderPlannerRunsTable.threadId, thread.id),
        ),
      ),
    db
      .update(agentBuilderMessagesTable)
      .set({ cardsJson: updatedStarterPackJson })
      .where(
        and(
          eq(agentBuilderMessagesTable.plannerRunId, input.plannerRunId),
          eq(agentBuilderMessagesTable.role, "assistant"),
          eq(agentBuilderMessagesTable.threadId, thread.id),
        ),
      ),
    db.insert(agentBuilderMessagesTable).values(messageRows),
    db
      .update(agentBuilderThreadsTable)
      .set({
        lastTurnAt: now,
        updatedAt: now,
      })
      .where(eq(agentBuilderThreadsTable.id, thread.id)),
  ]);

  return messageRows.map(toAgentBuilderMessageModel);
}
