export interface AgentBuilderSubmitGateInput {
  readonly actionPending: boolean;
  readonly autoApplyPending: boolean;
  readonly historyError: Error | null;
  readonly systemAgentBusy: boolean;
  readonly systemAgentReady: boolean;
}

export function canSubmitAgentBuilderTurn(input: AgentBuilderSubmitGateInput): boolean {
  return (
    input.systemAgentReady &&
    !input.systemAgentBusy &&
    !input.autoApplyPending &&
    !input.actionPending &&
    input.historyError === null
  );
}
