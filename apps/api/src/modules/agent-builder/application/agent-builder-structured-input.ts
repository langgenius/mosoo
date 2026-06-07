import type { AgentBuilderPlannerTurnInputKind } from "@mosoo/contracts/agent-builder";

export interface AgentBuilderStructuredReplyInput {
  readonly customText: string | null;
  readonly mode: string;
  readonly nodeKey: string;
  readonly selectedOptionKeys: readonly string[];
  readonly skipped: boolean;
  readonly type: "agent_builder_structured_input";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function parseAgentBuilderStructuredReply(
  inputText: string,
): AgentBuilderStructuredReplyInput | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(inputText);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const customText = parsed["customText"];
  const mode = parsed["mode"];
  const nodeKey = parsed["nodeKey"];
  const selectedOptionKeys = parsed["selectedOptionKeys"];
  const skipped = parsed["skipped"];
  const type = parsed["type"];

  if (
    type !== "agent_builder_structured_input" ||
    (customText !== null && typeof customText !== "string") ||
    typeof mode !== "string" ||
    typeof nodeKey !== "string" ||
    !isStringArray(selectedOptionKeys) ||
    typeof skipped !== "boolean"
  ) {
    return null;
  }

  return {
    customText,
    mode,
    nodeKey,
    selectedOptionKeys,
    skipped,
    type,
  };
}

export function detectAgentBuilderPlannerTurnInputKind(
  inputText: string,
): AgentBuilderPlannerTurnInputKind {
  return parseAgentBuilderStructuredReply(inputText) === null ? "user_message" : "question_answer";
}
