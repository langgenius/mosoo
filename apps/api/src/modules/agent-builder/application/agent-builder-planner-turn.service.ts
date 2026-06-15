import type {
  AgentBuilderPlanNode,
  AgentBuilderPlanNodeActionKey,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerOutput,
} from "@mosoo/contracts/agent-builder";
import { parseAgentBuilderPlannerOutput } from "@mosoo/contracts/agent-builder";
import {
  agentBuilderMessagesTable,
  agentBuilderPlannerRunsTable,
  agentBuilderThreadsTable,
} from "@mosoo/db";
import type { AgentBuilderPlannerRunId, AgentId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { normalizeAgentBuilderDraftPatchNodes } from "./agent-builder-draft-patch-normalizer.service";
import { createAgentBuilderMessageId, createAgentBuilderPlannerRunId } from "./agent-builder-ids";
import { createAgentBuilderRequestDigest } from "./agent-builder-model-selection.service";
import { createAgentBuilderPlannerContext } from "./agent-builder-planner-context.service";
import { createAgentBuilderActionPlannerOutput } from "./agent-builder-planner-output-factory";
import type { AgentBuilderProgressReporter } from "./agent-builder-progress.service";
import { reportAgentBuilderProgress } from "./agent-builder-progress.service";
import { detectAgentBuilderPlannerTurnInputKind } from "./agent-builder-structured-input";
import { createCompletedAgentBuilderSystemAgentTerminalResult } from "./agent-builder-system-agent-terminal.service";
import type { AgentBuilderSystemAgentTerminalResult } from "./agent-builder-system-agent-terminal.service";
import {
  allocateAgentBuilderMessageSeq,
  ensureAgentBuilderThreadContext,
  isAgentBuilderMessageSequenceConflict,
  toAgentBuilderMessageModel,
} from "./agent-builder-thread.service";
import type { AgentBuilderMessageModel } from "./agent-builder-thread.service";

export interface AgentBuilderLightweightPlannerInput {
  readonly context: AgentBuilderPlannerContext;
  readonly progress?: AgentBuilderProgressReporter;
}

export interface AgentBuilderLightweightPlanner {
  readonly modelId?: string;
  plan(
    input: AgentBuilderLightweightPlannerInput,
  ): AgentBuilderPlannerOutput | Promise<AgentBuilderPlannerOutput>;
  readonly provider?: string;
}

interface AgentBuilderPlannerExecution {
  readonly modelId: string;
  readonly output: AgentBuilderPlannerOutput;
  readonly provider: string;
}

export interface AgentBuilderPlannerTurnResult {
  readonly messages: AgentBuilderMessageModel[];
  readonly terminal: AgentBuilderSystemAgentTerminalResult;
}

const MAX_USER_MESSAGE_LENGTH = 4000;
const NON_DRAFT_QUICKSTART_ACTION_KEYS = new Set<AgentBuilderPlanNodeActionKey>([
  "configure_environment",
  "create_agent",
]);

function normalizeUserMessage(inputText: string): string {
  const normalized = inputText.trim();

  if (!normalized) {
    throw new Error("Builder message cannot be empty.");
  }

  if (normalized.length > MAX_USER_MESSAGE_LENGTH) {
    throw new Error(`Builder message must be ${MAX_USER_MESSAGE_LENGTH} characters or fewer.`);
  }

  return normalized;
}

function createPlannerContextJson(
  context: AgentBuilderPlannerContext,
  input: {
    readonly completedAt: number;
    readonly errorMessage: string | null;
    readonly startedAt: number;
    readonly status: "blocked" | "completed";
  },
): string {
  return JSON.stringify({
    ...context,
    plannerExecution: {
      completedAt: toIsoString(input.completedAt),
      durationMs: Math.max(0, input.completedAt - input.startedAt),
      ...(input.errorMessage === null ? {} : { errorMessage: input.errorMessage }),
      fallback: "none",
      path: "lightweight_control_plane",
      startedAt: toIsoString(input.startedAt),
      status: input.status,
    },
  });
}

function normalizePlannerOutput(input: {
  readonly actorAccountId: AuthenticatedViewer["id"];
  readonly bindings: ApiBindings;
  readonly context: AgentBuilderPlannerContext;
  readonly output: AgentBuilderPlannerOutput;
  readonly plannerRunId: AgentBuilderPlannerRunId;
}): Promise<AgentBuilderPlannerOutput> {
  const sanitizedOutput = sanitizeNonDraftQuickstartActions({
    context: input.context,
    output: input.output,
  });

  return normalizeAgentBuilderDraftPatchNodes({
    actorAccountId: input.actorAccountId,
    bindings: input.bindings,
    context: input.context,
    mode: sanitizedOutput.mode,
    nodes: sanitizedOutput.nodes,
  }).then((nodes: AgentBuilderPlanNode[]) => {
    const output = {
      ...sanitizedOutput,
      nodes,
      plannerRunId: input.plannerRunId,
    };
    const parsed = parseAgentBuilderPlannerOutput(output);

    if (parsed === null) {
      throw new Error("Agent Builder lightweight planner returned invalid output.");
    }

    return parsed;
  });
}

function hasNonDraftQuickstartAction(nodes: readonly AgentBuilderPlanNode[]): boolean {
  return nodes.some((node) =>
    node.actions.some((action) => NON_DRAFT_QUICKSTART_ACTION_KEYS.has(action.actionKey)),
  );
}

function sanitizeNonDraftQuickstartActions(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly output: AgentBuilderPlannerOutput;
}): AgentBuilderPlannerOutput {
  if (input.context.agent.status === "draft" || !hasNonDraftQuickstartAction(input.output.nodes)) {
    return input.output;
  }

  return createAgentBuilderActionPlannerOutput({
    actionKey: "apply_agent_config",
    assistantText:
      "这个 Agent 已经存在。我会把当前配置当成 Manifest refactor 来处理，不会重新带你走 Quickstart 初始化；如果右侧配置已经正确，可以点击 Apply changes 写回 Agent。",
    context: input.context,
    intentSummary: "Rewrite non-draft Quickstart action to Agent Manifest refactor apply.",
    label: "Apply changes",
    summary: "Apply the current Agent Manifest changes without restarting Quickstart.",
  });
}

async function runPlanner(input: {
  readonly bindings: ApiBindings;
  readonly context: AgentBuilderPlannerContext;
  readonly planner: AgentBuilderLightweightPlanner;
  readonly plannerRunId: AgentBuilderPlannerRunId;
  readonly progress?: AgentBuilderProgressReporter;
  readonly viewer: AuthenticatedViewer;
}): Promise<AgentBuilderPlannerExecution> {
  reportAgentBuilderProgress(input.progress, {
    message: "正在读取当前配置并规划下一步",
    stage: "planner:lightweight",
  });

  const output = await input.planner.plan({
    context: input.context,
    ...(input.progress === undefined ? {} : { progress: input.progress }),
  });

  const normalizedOutput = await normalizePlannerOutput({
    actorAccountId: input.viewer.id,
    bindings: input.bindings,
    context: input.context,
    output,
    plannerRunId: input.plannerRunId,
  });

  return {
    modelId: input.planner.modelId ?? "deterministic-planner",
    output: normalizedOutput,
    provider: input.planner.provider ?? "agent-builder-lightweight",
  };
}

export async function appendAgentBuilderPlannerTurnResult(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    readonly agentId: AgentId;
    readonly draftRevision: string;
    readonly draftYaml: string;
    readonly inputText: string;
    readonly planner: AgentBuilderLightweightPlanner;
    readonly progress?: AgentBuilderProgressReporter;
  },
): Promise<AgentBuilderPlannerTurnResult> {
  const rawContentText = normalizeUserMessage(input.inputText);
  const inputKind = detectAgentBuilderPlannerTurnInputKind(rawContentText);
  const contentText = rawContentText;
  const draftYaml = input.draftYaml;
  const { agent, thread } = await ensureAgentBuilderThreadContext(
    bindings.DB,
    viewer,
    input.agentId,
  );
  const now = currentTimestampMs();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const plannerRunId = createAgentBuilderPlannerRunId();
    const userMessageId = createAgentBuilderMessageId();

    reportAgentBuilderProgress(input.progress, {
      message: "正在读取 Draft、历史消息和可见资产",
      stage: "context",
    });

    const plannerContext = await createAgentBuilderPlannerContext(bindings, viewer, {
      agent,
      draftRevision: input.draftRevision,
      draftYaml,
      inputKind,
      inputText: contentText,
      plannerRunId,
      threadId: thread.id,
      triggerMessageId: userMessageId,
    });
    const plannerStartedAt = currentTimestampMs();
    const plannerExecution = await runPlanner({
      bindings,
      context: plannerContext,
      planner: input.planner,
      plannerRunId,
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      viewer,
    });
    const plannerOutput = plannerExecution.output;
    const plannerCompletedAt = currentTimestampMs();
    const outputJson = JSON.stringify(plannerOutput);
    const plannerRunStatus = plannerOutput.mode === "blocked" ? "blocked" : "completed";
    const requestDigest = await createAgentBuilderRequestDigest(plannerContext);

    reportAgentBuilderProgress(input.progress, {
      message: "正在保存 Builder 结果",
      stage: "ledger",
    });

    const firstSeq = await allocateAgentBuilderMessageSeq(bindings.DB, {
      count: 2,
      threadId: thread.id,
    });
    const messageRows = [
      {
        cardsJson: null,
        contentText,
        createdAt: now,
        createdByAccountId: viewer.id,
        id: userMessageId,
        inputKind,
        plannerRunId,
        role: "user" as const,
        seq: firstSeq,
        threadId: thread.id,
      },
      {
        cardsJson: outputJson,
        contentText: plannerOutput.assistantText,
        createdAt: now + 1,
        createdByAccountId: null,
        id: createAgentBuilderMessageId(),
        inputKind: null,
        plannerRunId,
        role: "assistant" as const,
        seq: firstSeq + 1,
        threadId: thread.id,
      },
    ];

    try {
      await runAppDatabaseBatch(bindings.DB, (db) => [
        db.insert(agentBuilderMessagesTable).values(messageRows),
        db.insert(agentBuilderPlannerRunsTable).values({
          agentId: thread.agentId,
          completedAt: plannerCompletedAt,
          contextJson: createPlannerContextJson(plannerContext, {
            completedAt: plannerCompletedAt,
            errorMessage: null,
            startedAt: plannerStartedAt,
            status: plannerRunStatus,
          }),
          createdAt: now,
          errorCode: null,
          errorMessage: null,
          id: plannerRunId,
          model: plannerExecution.modelId,
          outputJson,
          provider: plannerExecution.provider,
          requestDigest,
          status: plannerRunStatus,
          threadId: thread.id,
          toolTraceJson: null,
          traceId: plannerRunId,
          triggerMessageId: userMessageId,
        }),
        db
          .update(agentBuilderThreadsTable)
          .set({
            lastTurnAt: now,
            updatedAt: now,
          })
          .where(eq(agentBuilderThreadsTable.id, thread.id)),
      ]);

      return {
        messages: messageRows.map(toAgentBuilderMessageModel),
        terminal: createCompletedAgentBuilderSystemAgentTerminalResult(),
      };
    } catch (error) {
      if (attempt < 4 && isAgentBuilderMessageSequenceConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to allocate Agent Builder message sequences.");
}
