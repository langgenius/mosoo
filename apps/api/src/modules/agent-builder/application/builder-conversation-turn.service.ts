import type {
  AgentBuilderPlannerContext,
  AgentBuilderStarterPackResult,
  AgentBuilderToolExecutionRecord,
} from "@mosoo/contracts/agent-builder";
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
import { createAgentBuilderMessageId, createAgentBuilderPlannerRunId } from "./agent-builder-ids";
import { createAgentBuilderRequestDigest } from "./agent-builder-model-selection.service";
import { createAgentBuilderPlannerContext } from "./agent-builder-planner-context.service";
import {
  reportAgentBuilderProgress,
  withAgentBuilderProgressReporting,
} from "./agent-builder-progress.service";
import type { AgentBuilderProgressReporter } from "./agent-builder-progress.service";
import {
  createCompletedAgentBuilderSystemAgentTerminalResult,
  createFailedAgentBuilderSystemAgentTerminalResult,
} from "./agent-builder-system-agent-terminal.service";
import type { AgentBuilderSystemAgentTerminalResult } from "./agent-builder-system-agent-terminal.service";
import {
  allocateAgentBuilderMessageSeq,
  ensureAgentBuilderThreadContext,
  isAgentBuilderMessageSequenceConflict,
  toAgentBuilderMessageModel,
} from "./agent-builder-thread.service";
import type { AgentBuilderMessageModel } from "./agent-builder-thread.service";
import type { AgentBuilderToolRuntime } from "./agent-builder-tool-runtime.service";
import { runAgentBuilderAssemblyWorkflow } from "./builder-assembly-workflow.service";
import type { AgentBuilderAssemblyWorkflowRunResult } from "./builder-assembly-workflow.service";
import type { BuilderWorkflowExecutor } from "./builder-workflow-executor.service";

export type AgentBuilderAssemblyToolRuntimeFactory = (
  context: AgentBuilderPlannerContext,
) => AgentBuilderToolRuntime;

export type AgentBuilderAssemblyWorkflowCodeFactory = (
  context: AgentBuilderPlannerContext,
) => Promise<string> | string;

export interface AgentBuilderAssemblyTurnResult {
  readonly messages: AgentBuilderMessageModel[];
  readonly terminal: AgentBuilderSystemAgentTerminalResult;
}

const MAX_USER_MESSAGE_LENGTH = 4000;

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

function createAssemblyWorkflowContextJson(
  context: AgentBuilderPlannerContext,
  input: {
    completedAt: number;
    errorMessage: string | null;
    startedAt: number;
    status: "blocked" | "completed" | "failed";
  },
): string {
  return JSON.stringify({
    ...context,
    workflowExecution: {
      completedAt: toIsoString(input.completedAt),
      durationMs: Math.max(0, input.completedAt - input.startedAt),
      ...(input.errorMessage === null ? {} : { errorMessage: input.errorMessage }),
      fallback: "none",
      path: "builder_assembly",
      startedAt: toIsoString(input.startedAt),
      status: input.status,
    },
  });
}

const PLAINTEXT_SECRET_INPUT_PATTERNS: readonly RegExp[] = [
  /\b(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*|api[_-]?key|token|secret|password)\s*[:=]\s*\S{3,}/i,
  /\bAuthorization\s*:\s*Bearer\s+\S+/i,
  /\bBearer\s+[A-Za-z0-9_\-.~+/=]{3,}/i,
  /\bsk-[A-Za-z0-9_-]{3,}\b/i,
];

function containsPlaintextSecretInput(inputText: string): boolean {
  return PLAINTEXT_SECRET_INPUT_PATTERNS.some((pattern) => pattern.test(inputText));
}

function createSecretInputBlockedStarterPackResult(
  plannerRunId: AgentBuilderPlannerRunId,
): AgentBuilderStarterPackResult {
  return {
    assistantText:
      "不要在 Agent Builder 对话里输入或保存 provider key、API key、密钥或 token。我不会把这段内容写入工具调用或 Draft；请去 Provider Credential、Environment 或 MCP 的专用安全配置入口保存。",
    intentSummary: "Plaintext secret input was blocked before workflow execution.",
    items: [
      {
        action: { type: "none" },
        approvalMode: "blocked",
        assetType: "agent_field",
        evidenceRefs: [],
        nodeKey: "blocked_plaintext_secret_input",
        reason:
          "Composer 不接收明文 secret、provider key、bearer token 或 API key；这些值必须通过专门的安全配置入口录入。",
        status: "blocked",
        title: "请改用安全配置入口保存密钥",
      },
    ],
    mode: "starter_pack",
    plannerRunId,
    version: 1,
  };
}

function createBlockedAssemblyStarterPackResult(input: {
  errors: string[];
  plannerRunId: AgentBuilderPlannerRunId;
  status: "blocked" | "failed";
}): AgentBuilderStarterPackResult {
  const reason = input.errors.join(" ");

  return {
    assistantText:
      input.status === "blocked"
        ? `Agent Builder Assembly 被安全校验拦截：${reason}`
        : `Agent Builder Assembly 执行失败：${reason}`,
    intentSummary:
      input.status === "blocked"
        ? "The Assembly workflow result was blocked by admission checks."
        : "The Assembly workflow execution failed before producing an admissible Starter Pack.",
    items: [
      {
        action: { type: "none" },
        approvalMode: "blocked",
        assetType: "agent_field",
        evidenceRefs: [],
        nodeKey: `${input.status}_assembly_workflow`,
        reason,
        status: "blocked",
        title:
          input.status === "blocked" ? "Assembly workflow blocked" : "Assembly workflow failed",
      },
    ],
    mode: "starter_pack",
    plannerRunId: input.plannerRunId,
    version: 1,
  };
}

function createCompletedAssemblyWorkflowRunResult(
  result: AgentBuilderStarterPackResult,
  trace: AgentBuilderToolExecutionRecord[] = [],
): Extract<AgentBuilderAssemblyWorkflowRunResult, { status: "completed" }> {
  return {
    execution: {
      errorMessage: null,
      logs: [],
      result,
      trace,
    },
    result,
    status: "completed",
  };
}

function formatAssemblyWorkflowError(error: unknown): string {
  return error instanceof Error ? error.message : "Agent Builder Assembly failed.";
}

function createFailedAssemblyWorkflowRunResult(
  error: unknown,
): Extract<AgentBuilderAssemblyWorkflowRunResult, { status: "failed" }> {
  const errorMessage = formatAssemblyWorkflowError(error);

  return {
    errors: [errorMessage],
    execution: {
      errorMessage,
      logs: [],
      result: null,
      trace: [],
    },
    status: "failed",
  };
}

function createTerminalResultForWorkflow(
  workflowResult: AgentBuilderAssemblyWorkflowRunResult,
): AgentBuilderSystemAgentTerminalResult {
  if (workflowResult.status === "completed" || workflowResult.status === "blocked") {
    return createCompletedAgentBuilderSystemAgentTerminalResult();
  }

  return createFailedAgentBuilderSystemAgentTerminalResult({
    failureKind: workflowResult.execution.trace.some((record) => record.status === "failed")
      ? "tool_failure"
      : "model_failure",
    message: workflowResult.errors.join(" "),
  });
}

async function resolveAssemblyWorkflowCode(
  code: AgentBuilderAssemblyWorkflowCodeFactory | string,
  context: AgentBuilderPlannerContext,
): Promise<string> {
  return typeof code === "function" ? await code(context) : code;
}

async function runConversationWorkflow(input: {
  code: AgentBuilderAssemblyWorkflowCodeFactory | string;
  contentText: string;
  executor: BuilderWorkflowExecutor;
  plannerContext: AgentBuilderPlannerContext;
  plannerRunId: AgentBuilderPlannerRunId;
  progress?: AgentBuilderProgressReporter;
  timeoutMs: number;
  tools: AgentBuilderToolRuntime;
}): Promise<AgentBuilderAssemblyWorkflowRunResult> {
  if (containsPlaintextSecretInput(input.contentText)) {
    reportAgentBuilderProgress(input.progress, {
      message: "检测到密钥内容，正在生成安全提示",
      stage: "preflight:secret",
    });

    return createCompletedAssemblyWorkflowRunResult(
      createSecretInputBlockedStarterPackResult(input.plannerRunId),
    );
  }

  try {
    reportAgentBuilderProgress(input.progress, {
      message: "正在规划可执行的 Builder 工作流",
      stage: "workflow:code_generation",
    });
    const code = await resolveAssemblyWorkflowCode(input.code, input.plannerContext);

    reportAgentBuilderProgress(input.progress, {
      message: "正在执行 Builder 工具并校验结果",
      stage: "workflow:execution",
    });

    return await runAgentBuilderAssemblyWorkflow({
      code,
      executor: input.executor,
      plannerRunId: input.plannerRunId,
      timeoutMs: input.timeoutMs,
      tools: input.tools,
    });
  } catch (error) {
    return createFailedAssemblyWorkflowRunResult(error);
  }
}

export async function appendAgentBuilderAssemblyTurnResult(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    code: AgentBuilderAssemblyWorkflowCodeFactory | string;
    draftRevision: string;
    draftYaml: string;
    executor: BuilderWorkflowExecutor;
    inputText: string;
    progress?: AgentBuilderProgressReporter;
    timeoutMs: number;
    tools: AgentBuilderAssemblyToolRuntimeFactory | AgentBuilderToolRuntime;
  },
): Promise<AgentBuilderAssemblyTurnResult> {
  const contentText = normalizeUserMessage(input.inputText);
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
      draftYaml: input.draftYaml,
      inputKind: "user_message",
      inputText: contentText,
      plannerRunId,
      threadId: thread.id,
      triggerMessageId: userMessageId,
    });
    const tools = withAgentBuilderProgressReporting({
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      tools: typeof input.tools === "function" ? input.tools(plannerContext) : input.tools,
    });
    const workflowStartedAt = currentTimestampMs();
    const workflowResult = await runConversationWorkflow({
      code: input.code,
      contentText,
      executor: input.executor,
      plannerContext,
      plannerRunId,
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      timeoutMs: input.timeoutMs,
      tools,
    });
    const workflowCompletedAt = currentTimestampMs();
    const plannerOutput =
      workflowResult.status === "completed"
        ? {
            ...workflowResult.result,
            plannerRunId,
          }
        : createBlockedAssemblyStarterPackResult({
            errors: workflowResult.errors,
            plannerRunId,
            status: workflowResult.status,
          });
    const outputJson = JSON.stringify(plannerOutput);
    const workflowExecutionStatus =
      workflowResult.status === "completed"
        ? "completed"
        : workflowResult.status === "blocked"
          ? "blocked"
          : "failed";
    const status = workflowExecutionStatus === "completed" ? "completed" : "failed";
    const errorMessage =
      workflowResult.status === "completed" ? null : workflowResult.errors.join(" ");
    const toolTraceJson =
      workflowResult.status === "completed" && workflowResult.execution.trace.length === 0
        ? null
        : JSON.stringify(workflowResult.execution.trace);
    const requestDigest = await createAgentBuilderRequestDigest(plannerContext);
    reportAgentBuilderProgress(input.progress, {
      message: "正在保存 Builder 结果",
      stage: "ledger",
    });
    const contextJson = createAssemblyWorkflowContextJson(plannerContext, {
      completedAt: workflowCompletedAt,
      errorMessage,
      startedAt: workflowStartedAt,
      status: workflowExecutionStatus,
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
        inputKind: "user_message" as const,
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
          completedAt: now + 1,
          contextJson,
          createdAt: now,
          errorCode: status === "failed" ? "assembly_workflow_failed" : null,
          errorMessage,
          id: plannerRunId,
          model: "assembly-workflow",
          organizationId: thread.organizationId,
          outputJson,
          provider: "agent-builder-v3",
          requestDigest,
          status,
          threadId: thread.id,
          toolTraceJson,
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
        terminal: createTerminalResultForWorkflow(workflowResult),
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

export async function appendAgentBuilderAssemblyTurn(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: Parameters<typeof appendAgentBuilderAssemblyTurnResult>[2],
): Promise<AgentBuilderMessageModel[]> {
  return (await appendAgentBuilderAssemblyTurnResult(bindings, viewer, input)).messages;
}
