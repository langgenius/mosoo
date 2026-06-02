import { parseAgentBuilderPlannerDraft } from "../agent-builder-draft-parser";
import type { AgentBuilderToolDefinition } from "../agent-builder-tool-runtime.service";

function readRequiredString(input: Record<string, unknown>, fieldName: string): string {
  const value = input[fieldName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`get_draft_snapshot requires ${fieldName}.`);
  }

  return value;
}

export function createGetDraftSnapshotTool(): AgentBuilderToolDefinition {
  return {
    execute(input) {
      const draftRevision = readRequiredString(input, "draftRevision");
      const draftYaml = readRequiredString(input, "draftYaml");
      const draft = parseAgentBuilderPlannerDraft(draftYaml);

      return {
        agentsFileId: draft.agentsFileId,
        channelIds: draft.channelIds,
        description: draft.description,
        draftRevision,
        draftYamlLength: draftYaml.length,
        environmentId: draft.environmentId,
        mcpServerIds: draft.mcpServerIds,
        mcpServersRepresented: draft.mcpServersRepresented,
        model: draft.model,
        name: draft.name,
        parseError: draft.parseError,
        parseStatus: draft.parseStatus,
        prompt: draft.prompt,
        provider: draft.provider,
        runtimeId: draft.runtimeId,
        skillIds: draft.skillIds,
        spaceIds: draft.spaceIds,
      };
    },
    toolId: "get_draft_snapshot",
  };
}
