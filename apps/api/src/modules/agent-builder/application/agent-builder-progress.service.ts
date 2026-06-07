export interface AgentBuilderProgressEvent {
  readonly message: string;
  readonly stage: string;
}

export type AgentBuilderProgressReporter = (event: AgentBuilderProgressEvent) => void;

export function reportAgentBuilderProgress(
  reporter: AgentBuilderProgressReporter | undefined,
  event: AgentBuilderProgressEvent,
): void {
  reporter?.(event);
}
