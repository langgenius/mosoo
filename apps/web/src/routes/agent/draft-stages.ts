import type { AgentEditorDraft } from "./components/editor/draft";

export const DEFAULT_AGENT_NAME = "Untitled agent";

export type AgentDraftStageId = "agent_type" | "assembly" | "identity";

export interface AgentDraftStage {
  readonly complete: boolean;
  readonly id: AgentDraftStageId;
  readonly label: string;
}

// Soft guidance only: stages order the Builder conversation and the header
// indicator, they never gate Test in Chat.
export function listAgentDraftStages(draft: AgentEditorDraft): AgentDraftStage[] {
  const name = draft.name.trim();
  const identityComplete =
    name.length > 0 &&
    name !== DEFAULT_AGENT_NAME &&
    draft.runtime.trim().length > 0 &&
    draft.provider.trim().length > 0 &&
    draft.model.trim().length > 0;
  const agentTypeComplete = draft.componentDecisions.agentType !== undefined;
  const assemblyComplete =
    draft.componentDecisions.environment !== undefined ||
    draft.skills.length > 0 ||
    draft.mcpServers.length > 0 ||
    draft.spaces.length > 0;

  return [
    { complete: identityComplete, id: "identity", label: "Identity" },
    { complete: agentTypeComplete, id: "agent_type", label: "Agent type" },
    { complete: assemblyComplete, id: "assembly", label: "Components" },
  ];
}

// The manual-path Test in Chat gate: only the fields persistDraft refuses to
// save without. Readiness issues are surfaced later by the preview composer.
export function hasRequiredAgentDraftFields(draft: AgentEditorDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.model.trim().length > 0 &&
    draft.provider.trim().length > 0
  );
}
