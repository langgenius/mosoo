import { AGENT_BUILDER_TOOL_ID_VALUES } from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderPlannerContext,
  AgentBuilderToolId,
} from "@mosoo/contracts/agent-builder";

import {
  AGENT_BUILDER_WORKFLOW_INTENT_CLASSES,
  AGENT_BUILDER_WORKFLOW_SOURCE_MODES,
} from "./builder-workflow-code-plan";
import type { AgentBuilderWorkflowPlannerCodePlan } from "./builder-workflow-code-plan";
import { validateAgentBuilderAssemblyWorkflowPlan } from "./builder-workflow-code-validation";

const AGENT_BUILDER_WORKFLOW_INTENT_CLASS_VALUES = new Set<string>(
  AGENT_BUILDER_WORKFLOW_INTENT_CLASSES,
);
const AGENT_BUILDER_WORKFLOW_SOURCE_MODE_VALUES = new Set<string>(
  AGENT_BUILDER_WORKFLOW_SOURCE_MODES,
);
const AGENT_BUILDER_TOOL_IDS = new Set<string>(AGENT_BUILDER_TOOL_ID_VALUES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAgentBuilderToolId(value: unknown): value is AgentBuilderToolId {
  return typeof value === "string" && AGENT_BUILDER_TOOL_IDS.has(value);
}

function readOpenAiText(value: unknown): string {
  if (isRecord(value)) {
    const outputText = value["output_text"];

    if (typeof outputText === "string") {
      return outputText;
    }
  }

  const output = isRecord(value) ? value["output"] : null;

  if (!Array.isArray(output)) {
    return "";
  }

  const parts: string[] = [];

  for (const item of output) {
    const content = isRecord(item) ? item["content"] : null;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (!isRecord(contentItem)) {
        continue;
      }

      const text = contentItem["text"];

      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }

  return parts.join("\n").trim();
}

function isAgentBuilderWorkflowIntentClass(
  value: unknown,
): value is AgentBuilderWorkflowPlannerCodePlan["intentClass"] {
  return typeof value === "string" && AGENT_BUILDER_WORKFLOW_INTENT_CLASS_VALUES.has(value);
}

function isAgentBuilderWorkflowSourceMode(
  value: unknown,
): value is AgentBuilderWorkflowPlannerCodePlan["sourceMode"] {
  return typeof value === "string" && AGENT_BUILDER_WORKFLOW_SOURCE_MODE_VALUES.has(value);
}

function parseToolSequence(value: unknown): AgentBuilderToolId[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const toolIds: AgentBuilderToolId[] = [];

  for (const entry of value) {
    if (!isAgentBuilderToolId(entry)) {
      return null;
    }

    toolIds.push(entry);
  }

  return toolIds;
}

export function parseGeneratedCodePayload(
  payload: unknown,
  context?: AgentBuilderPlannerContext,
): AgentBuilderWorkflowPlannerCodePlan {
  const rawText = readOpenAiText(payload).trim();

  if (rawText.length === 0) {
    throw new Error("Agent Builder workflow code generation returned empty text.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error.";
    throw new Error(`Agent Builder workflow code generation returned invalid JSON: ${message}`, {
      cause: error,
    });
  }

  const root = isRecord(parsed) ? parsed : {};
  const code = root["code"];
  const intentClass = root["intentClass"];
  const sourceMode = root["sourceMode"];
  const toolSequence = parseToolSequence(root["toolSequence"]);

  if (!isAgentBuilderWorkflowIntentClass(intentClass)) {
    throw new Error("Agent Builder workflow code generation did not return a valid intentClass.");
  }

  if (!isAgentBuilderWorkflowSourceMode(sourceMode)) {
    throw new Error("Agent Builder workflow code generation did not return a valid sourceMode.");
  }

  if (toolSequence === null) {
    throw new Error("Agent Builder workflow code generation did not return a valid toolSequence.");
  }

  if (typeof code !== "string" || code.trim().length === 0) {
    throw new Error("Agent Builder workflow code generation did not return a code string.");
  }

  const normalizedCode = code.trim();
  const plan: AgentBuilderWorkflowPlannerCodePlan = {
    code: normalizedCode,
    intentClass,
    sourceMode,
    toolSequence,
  };
  const validationErrors = validateAgentBuilderAssemblyWorkflowPlan(plan, context);

  if (validationErrors.length > 0) {
    throw new Error(
      `Agent Builder workflow code generation produced unsafe code: ${validationErrors.join(" ")}`,
    );
  }

  return plan;
}
