import {
  createEmptyResolutionSummary,
  createPackageResolutionState,
  createResolutionReport,
} from "@mosoo/agent-package";
import type { Agent } from "@mosoo/contracts/agent";
import type {
  AgentPackageImportResult,
  AgentResolutionIssue,
  CreateAgentForkInput,
} from "@mosoo/contracts/agent-manifest";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureAgentPackageAccess } from "./agent-access.service";
import { buildAgentManifest } from "./agent-manifest.service";
import { toAgentModel } from "./agent-models";
import { bindDraftAgentMcpServers, createDraftAgent } from "./agent-package-draft.service";
import { resolveForkMcpServers } from "./agent-package-mcp-resolution.service";
import { resolvePackageSkills, resolvePackageSpaces } from "./agent-package-resolution.service";
import { collectRuntimeCapabilityIssues } from "./agent-runtime-capability-resolution.service";
import { parseAgentStoredConfig } from "./agent-stored-config.service";
export async function createAgentFork(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateAgentForkInput,
): Promise<AgentPackageImportResult<Agent>> {
  const { agent: sourceAgent } = await ensureAgentPackageAccess(
    bindings.DB,
    viewer.id,
    input.agentId,
  );
  const forkKind = input.kind ?? sourceAgent.kind;
  const manifest = await buildAgentManifest(bindings.DB, sourceAgent);
  const summary = createEmptyResolutionSummary();
  const issues: AgentResolutionIssue[] = [];
  const sourceStoredConfig = parseAgentStoredConfig(sourceAgent.configJson);

  issues.push(
    ...(await collectRuntimeCapabilityIssues({
      actorAccountId: viewer.id,
      codePrefix: "agent.fork",
      database: bindings.DB,
      organizationId: sourceAgent.organizationId,
      selection: {
        model: manifest.runtime.model,
        provider: manifest.runtime.provider,
        runtimeId: manifest.runtime.id,
      },
    })),
  );

  const [skillResolution, spaceIds, mcpResolution] = await Promise.all([
    resolvePackageSkills({
      allowSourceSkillIds: true,
      database: bindings.DB,
      issues,
      manifest,
      organizationId: sourceAgent.organizationId,
      summary,
      viewerId: viewer.id,
    }),
    resolvePackageSpaces({
      database: bindings.DB,
      issues,
      manifest,
      organizationId: sourceAgent.organizationId,
      summary,
      viewerId: viewer.id,
    }),
    resolveForkMcpServers({
      database: bindings.DB,
      issues,
      manifest,
      organizationId: sourceAgent.organizationId,
      summary,
      viewerId: viewer.id,
    }),
  ]);
  summary.boundSkillCount += sourceStoredConfig.packageSkills.length;
  const resolution = createResolutionReport(issues, summary);

  const agent = await createDraftAgent(bindings.DB, {
    agentName: `${sourceAgent.name} Copy`,
    description: sourceAgent.description,
    environmentId: sourceAgent.environmentId,
    kind: forkKind,
    model: sourceAgent.model,
    organizationId: sourceAgent.organizationId,
    ownerId: viewer.id,
    packageMcpServers: mcpResolution.packageMcpServers,
    packageResolution: createPackageResolutionState("fork", resolution),
    packageSkills: sourceStoredConfig.packageSkills,
    prompt: sourceAgent.prompt,
    provider: sourceAgent.provider,
    runtimeId: sourceAgent.runtimeId,
    skillIds: skillResolution.skillIds,
    spaceIds,
  });

  await bindDraftAgentMcpServers(bindings.DB, agent.id, mcpResolution.serverIds);

  return {
    agent: await toAgentModel(bindings.DB, viewer, agent),
    resolution,
  };
}
