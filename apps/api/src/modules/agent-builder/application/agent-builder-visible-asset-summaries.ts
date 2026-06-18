import type {
  AgentBuilderVisibleAssetProviderInput,
  AgentBuilderVisibleAssetSummaryCollections,
} from "./agent-builder-visible-assets.types";
import { collectAgentBuilderVisibleEnvironmentSummaries } from "./agent-builder-visible-environment-summaries";
import { collectAgentBuilderVisibleMcpServerSummaries } from "./agent-builder-visible-mcp-server-summaries";
import { collectAgentBuilderVisibleSkillSummaries } from "./agent-builder-visible-skill-summaries";

export async function collectAgentBuilderVisibleAssetSummaries(
  input: AgentBuilderVisibleAssetProviderInput,
): Promise<AgentBuilderVisibleAssetSummaryCollections> {
  const [environments, mcpServers, skills] = await Promise.all([
    collectAgentBuilderVisibleEnvironmentSummaries({
      bindings: input.bindings,
      environmentId: input.draft.environmentId,
      appId: input.appId,
      viewer: input.viewer,
    }),
    collectAgentBuilderVisibleMcpServerSummaries({
      bindingRepresented: input.draft.mcpServersRepresented,
      bindings: input.bindings,
      boundMcpServerIds: input.boundMcpServerIds,
      appId: input.appId,
      viewer: input.viewer,
    }),
    collectAgentBuilderVisibleSkillSummaries({
      bindings: input.bindings,
      boundSkillIds: input.boundSkillIds,
      appId: input.appId,
      viewer: input.viewer,
    }),
  ]);

  return {
    environments,
    mcpServers,
    skills,
  };
}
