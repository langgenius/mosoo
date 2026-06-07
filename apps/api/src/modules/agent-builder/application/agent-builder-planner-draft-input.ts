import type { AgentBuilderLightweightPlannerDraftContext } from "./agent-builder-lightweight-draft-types";
import { toAgentBuilderPlannerDraftContext } from "./agent-builder-lightweight-manifest-projections";

export type AgentBuilderPlannerDraftInput =
  | {
      readonly draft: AgentBuilderLightweightPlannerDraftContext;
      readonly draftYaml?: never;
    }
  | {
      readonly draft?: never;
      readonly draftYaml: string;
    };

export interface AgentBuilderPlannerDraftInputFields {
  readonly draft?: AgentBuilderLightweightPlannerDraftContext;
  readonly draftYaml?: string;
}

export function resolveAgentBuilderPlannerDraftInput(
  input: AgentBuilderPlannerDraftInputFields,
): AgentBuilderLightweightPlannerDraftContext {
  if (input.draft !== undefined && input.draftYaml !== undefined) {
    throw new Error("Agent Builder draft context input must not provide both draft and draftYaml.");
  }

  if (input.draft !== undefined) {
    return input.draft;
  }

  if (input.draftYaml === undefined) {
    throw new Error("Agent Builder draft context input must provide draft or draftYaml.");
  }

  return toAgentBuilderPlannerDraftContext(input.draftYaml);
}
