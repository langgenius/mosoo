import type { AgentManifest, AgentManifestExport } from "@mosoo/contracts/agent-manifest";
import {
  serializeAgentManifestToJson,
  serializeAgentManifestToYaml,
} from "@mosoo/contracts/agent-manifest-serializer";
import type { AgentId, ProjectId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectAgentOwner } from "./agent-access.service";
import { buildAgentSpec, toAgentManifest } from "./agent-spec.service";
import type { AgentRow } from "./agent-types";

export async function buildAgentManifest(
  database: D1Database,
  agent: AgentRow,
): Promise<AgentManifest> {
  return toAgentManifest(await buildAgentSpec(database, agent));
}

export async function exportAgentManifest(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    projectId: ProjectId;
  },
): Promise<AgentManifestExport> {
  const editable = await ensureProjectAgentOwner(database, viewer.id, input);
  const manifest = await buildAgentManifest(database, editable.agent);

  return {
    agentId: editable.agent.id,
    json: serializeAgentManifestToJson(manifest, editable.agent.id),
    yaml: serializeAgentManifestToYaml(manifest, editable.agent.id),
  };
}
