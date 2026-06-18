import type {
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerOutput,
  AgentBuilderVisibleAssetIndexEntry,
  AgentBuilderVisibleAssetIndexListKey,
} from "@mosoo/contracts/agent-builder";

import {
  createAgentBuilderActionPlannerOutput,
  createAgentBuilderPlainTextPlannerOutput,
} from "./agent-builder-planner-output-factory";
import type { AgentBuilderStructuredReplyInput } from "./agent-builder-structured-input";

interface OptionalComponentSpec {
  readonly actionOptionKey?: string;
  readonly actionSummary?: string;
  readonly actionText?: string;
  readonly askText: string;
  readonly fieldPath: AgentBuilderDraftPatchFieldPath;
  readonly intentPatterns: readonly RegExp[];
  readonly listKey: AgentBuilderVisibleAssetIndexListKey;
  readonly nodeKey: string;
  readonly optionPrefix: string;
  readonly patchNodeKey: string;
  readonly patchSummary: string;
  readonly prompt: string;
  readonly targetType: AgentBuilderPlanNode["targetType"];
}

const MAX_COMPONENT_OPTIONS = 12;
const REMOTE_MCP_ACTION_KEY = "create_remote_mcp_server";
const REMOTE_MCP_OPTION_KEY = "action:create_remote_mcp_server";

const OPTIONAL_COMPONENT_SPECS = [
  {
    askText: "可以。你可以从当前可见的 Skills 中选择要绑定到这个 Agent 的能力，也可以先跳过。",
    fieldPath: "skillIds",
    intentPatterns: [/\bskills?\b/iu, /\bpdf\b/iu, /\bdocx\b/iu, /\bxlsx\b/iu, /\bpptx\b/iu],
    listKey: "skills",
    nodeKey: "ask_skills",
    optionPrefix: "skill:",
    patchNodeKey: "patch_skills",
    patchSummary: "Bind selected Skills to the Agent Manifest.",
    prompt: "Select Skills to bind to this Agent.",
    targetType: "skill",
  },
  {
    actionOptionKey: REMOTE_MCP_OPTION_KEY,
    actionSummary: "Open the secure remote MCP server creation UI.",
    actionText:
      "创建远程 MCP server 需要打开专用安全配置 UI。Builder 会在 Agent Manifest 中引用创建后的 server，不把 credential 写进 YAML；点击 Create remote MCP server 继续。",
    askText: "可以。你可以选择已有 MCP server，或通过安全 UI 创建新的远程 MCP server。",
    fieldPath: "mcpServerIds",
    intentPatterns: [/\bmcp\b/iu, /\bserver\b/iu, /远程\s*mcp/iu],
    listKey: "mcpServers",
    nodeKey: "ask_mcp_servers",
    optionPrefix: "mcp_server:",
    patchNodeKey: "patch_mcp_servers",
    patchSummary: "Bind selected MCP servers to the Agent Manifest.",
    prompt: "Select MCP servers to bind to this Agent.",
    targetType: "mcp",
  },
] as const satisfies readonly OptionalComponentSpec[];

function createComponentOptionKey(spec: OptionalComponentSpec, id: string): string {
  return `${spec.optionPrefix}${id}`;
}

function readComponentIdFromOptionKey(
  spec: OptionalComponentSpec,
  optionKey: string,
): string | null {
  return optionKey.startsWith(spec.optionPrefix) ? optionKey.slice(spec.optionPrefix.length) : null;
}

function findSpecByNodeKey(nodeKey: string): OptionalComponentSpec | null {
  return OPTIONAL_COMPONENT_SPECS.find((spec) => spec.nodeKey === nodeKey) ?? null;
}

export function isAgentBuilderOptionalComponentStructuredReplyNodeKey(nodeKey: string): boolean {
  return findSpecByNodeKey(nodeKey) !== null;
}

function findSpecByUserIntent(inputText: string): OptionalComponentSpec | null {
  return (
    OPTIONAL_COMPONENT_SPECS.find((spec) =>
      spec.intentPatterns.some((pattern) => pattern.test(inputText)),
    ) ?? null
  );
}

function createComponentOptions(context: AgentBuilderPlannerContext, spec: OptionalComponentSpec) {
  const assetOptions = context.assets.currentIndex[spec.listKey]
    .slice(0, MAX_COMPONENT_OPTIONS)
    .map((asset) => ({
      description:
        asset.bindingState === "bound" ? "Already bound to this draft." : "Visible component",
      label: asset.name,
      optionKey: createComponentOptionKey(spec, asset.id),
      value: asset.id,
    }));

  if (spec.actionOptionKey === undefined) {
    return assetOptions;
  }

  return [
    ...assetOptions,
    {
      description: "Open the secure remote MCP server creation flow.",
      label: "Create remote MCP server",
      optionKey: spec.actionOptionKey,
      value: REMOTE_MCP_ACTION_KEY,
    },
  ];
}

function isCurrentComponentQuestionPending(
  context: AgentBuilderPlannerContext,
  spec: OptionalComponentSpec,
): boolean {
  const latestOpenNode = context.historicalOpenNodes[0] ?? null;

  return (
    latestOpenNode !== null &&
    latestOpenNode.kind === "question" &&
    latestOpenNode.nodeKey === spec.nodeKey &&
    latestOpenNode.status === "pending" &&
    latestOpenNode.targetType === spec.targetType
  );
}

function createComponentQuestionPlannerOutput(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly spec: OptionalComponentSpec;
}): AgentBuilderPlannerOutput {
  const node: AgentBuilderPlanNode = {
    actions: [],
    askUser: {
      allowCustomText: true,
      allowSkip: true,
      mode: "multi_select",
      options: createComponentOptions(input.context, input.spec),
      prompt: input.spec.prompt,
      submitLabel: "Continue",
    },
    kind: "question",
    nodeKey: input.spec.nodeKey,
    operation: "ask",
    requiresConfirmation: false,
    status: "pending",
    summary: `Ask the user how to configure optional ${input.spec.fieldPath}.`,
    targetType: input.spec.targetType,
  };

  return {
    assistantText: input.spec.askText,
    intentSummary: `Ask the user to configure optional ${input.spec.fieldPath}.`,
    mode: "question",
    nodes: [node],
    plannerRunId: input.context.plannerRunId,
    version: 1,
  };
}

function createComponentDraftPatchPlannerOutput(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly ids: readonly string[];
  readonly spec: OptionalComponentSpec;
}): AgentBuilderPlannerOutput {
  return {
    assistantText: "已选择组件。我会把这些绑定写入当前 Agent Manifest。",
    intentSummary: `Bind selected optional ${input.spec.fieldPath}.`,
    mode: "draft_patch",
    nodes: [
      {
        actions: [],
        draftPatch: {
          fieldPath: input.spec.fieldPath,
          value: [...input.ids],
        },
        kind: "draft_patch",
        nodeKey: input.spec.patchNodeKey,
        operation: "bind",
        requiresConfirmation: false,
        status: "pending",
        summary: input.spec.patchSummary,
        targetType: "draft",
      },
    ],
    plannerRunId: input.context.plannerRunId,
    version: 1,
  };
}

function createRemoteMcpActionPlannerOutput(
  context: AgentBuilderPlannerContext,
  spec: OptionalComponentSpec,
): AgentBuilderPlannerOutput {
  return createAgentBuilderActionPlannerOutput({
    actionKey: REMOTE_MCP_ACTION_KEY,
    assistantText: spec.actionText ?? "Open the secure remote MCP server creation UI.",
    context,
    intentSummary: "Guide the user to the safe remote MCP server creation UI.",
    label: "Create remote MCP server",
    summary: spec.actionSummary ?? "Open the secure remote MCP server creation UI.",
  });
}

function createComponentDraftPatchWithRemoteMcpActionPlannerOutput(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly ids: readonly string[];
  readonly spec: OptionalComponentSpec;
}): AgentBuilderPlannerOutput {
  const patchOutput = createComponentDraftPatchPlannerOutput(input);
  const actionOutput = createRemoteMcpActionPlannerOutput(input.context, input.spec);

  return {
    ...patchOutput,
    assistantText:
      "已选择已有 MCP server。我会先把它写入当前 Agent Manifest；新的远程 MCP server 需要通过安全 UI 继续创建。",
    intentSummary:
      "Bind selected optional MCP servers and open the secure remote MCP server creation UI.",
    nodes: [...patchOutput.nodes, ...actionOutput.nodes],
  };
}

function findVisibleComponent(
  context: AgentBuilderPlannerContext,
  spec: OptionalComponentSpec,
  optionKey: string,
): AgentBuilderVisibleAssetIndexEntry | null {
  const selectedId = readComponentIdFromOptionKey(spec, optionKey);

  if (selectedId === null) {
    return null;
  }

  return context.assets.currentIndex[spec.listKey].find((asset) => asset.id === selectedId) ?? null;
}

export function planAgentBuilderOptionalComponentRequest(
  context: AgentBuilderPlannerContext,
): AgentBuilderPlannerOutput | null {
  const spec = findSpecByUserIntent(context.turn.inputText);

  return spec === null ? null : createComponentQuestionPlannerOutput({ context, spec });
}

export function planAgentBuilderOptionalComponentStructuredReply(input: {
  readonly context: AgentBuilderPlannerContext;
  readonly reply: AgentBuilderStructuredReplyInput;
}): AgentBuilderPlannerOutput | null {
  const spec = findSpecByNodeKey(input.reply.nodeKey);

  if (spec === null) {
    return null;
  }

  if (!isCurrentComponentQuestionPending(input.context, spec)) {
    return null;
  }

  if (input.reply.mode !== "multi_select" && input.reply.mode !== "free_text") {
    return createAgentBuilderPlainTextPlannerOutput({
      assistantText: "这个结构化回复的输入模式不属于当前组件选择流程；请重新选择组件。",
      intentSummary: "Reject a structured reply mode that does not match the component question.",
      plannerRunId: input.context.plannerRunId,
    });
  }

  if (input.reply.skipped) {
    return createAgentBuilderPlainTextPlannerOutput({
      assistantText: "已跳过这组可选组件；后续仍然可以回到 Builder 添加。",
      intentSummary: "Skip optional component binding.",
      plannerRunId: input.context.plannerRunId,
    });
  }

  const remoteMcpCreationRequested =
    spec.actionOptionKey !== undefined &&
    (input.reply.selectedOptionKeys.includes(spec.actionOptionKey) ||
      (input.reply.mode === "free_text" && input.reply.customText !== null));

  const selectedIds: string[] = [];

  for (const optionKey of input.reply.selectedOptionKeys) {
    if (optionKey === spec.actionOptionKey) {
      continue;
    }

    const selectedAsset = findVisibleComponent(input.context, spec, optionKey);

    if (selectedAsset === null) {
      return createAgentBuilderPlainTextPlannerOutput({
        assistantText: "有组件不在当前可见资产里。我不能直接绑定不可见资源；请重新选择。",
        intentSummary:
          "Reject an optional component selection that is not visible in planner context.",
        plannerRunId: input.context.plannerRunId,
      });
    }

    selectedIds.push(selectedAsset.id);
  }

  if (selectedIds.length === 0) {
    return remoteMcpCreationRequested
      ? createRemoteMcpActionPlannerOutput(input.context, spec)
      : createComponentQuestionPlannerOutput({
          context: input.context,
          spec,
        });
  }

  return remoteMcpCreationRequested
    ? createComponentDraftPatchWithRemoteMcpActionPlannerOutput({
        context: input.context,
        ids: selectedIds,
        spec,
      })
    : createComponentDraftPatchPlannerOutput({
        context: input.context,
        ids: selectedIds,
        spec,
      });
}
