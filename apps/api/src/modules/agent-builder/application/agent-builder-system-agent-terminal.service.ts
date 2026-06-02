export type AgentBuilderSystemAgentTerminalFailureKind =
  | "model_failure"
  | "tool_failure"
  | "transport_close";

export type AgentBuilderSystemAgentTerminalResult =
  | {
      readonly failureKind: null;
      readonly message: null;
      readonly status: "completed";
    }
  | {
      readonly failureKind: AgentBuilderSystemAgentTerminalFailureKind;
      readonly message: string;
      readonly status: "failed";
    };

export function createCompletedAgentBuilderSystemAgentTerminalResult(): AgentBuilderSystemAgentTerminalResult {
  return {
    failureKind: null,
    message: null,
    status: "completed",
  };
}

export function formatAgentBuilderSystemAgentTerminalError(error: unknown): string {
  return error instanceof Error ? error.message : "Agent Builder System Agent stream failed.";
}

export function createFailedAgentBuilderSystemAgentTerminalResult(input: {
  readonly failureKind: AgentBuilderSystemAgentTerminalFailureKind;
  readonly message: string;
}): AgentBuilderSystemAgentTerminalResult {
  return {
    failureKind: input.failureKind,
    message: input.message,
    status: "failed",
  };
}
