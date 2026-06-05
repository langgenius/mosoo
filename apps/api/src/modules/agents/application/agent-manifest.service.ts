import type { AgentManifest, AgentManifestExport } from "@mosoo/contracts/agent-manifest";
import {
  serializeAgentManifestToJson,
  serializeAgentManifestToYaml,
} from "@mosoo/contracts/agent-manifest-serializer";
import type { AgentId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureAgentEditor } from "./agent-access.service";
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
  agentId: AgentId,
): Promise<AgentManifestExport> {
  const editable = await ensureAgentEditor(database, viewer.id, agentId);
  const manifest = await buildAgentManifest(database, editable.agent);

  return {
    agentId: editable.agent.id,
    json: serializeAgentManifestToJson(manifest, editable.agent.id),
    yaml: serializeAgentManifestToYaml(manifest, editable.agent.id),
  };
}
