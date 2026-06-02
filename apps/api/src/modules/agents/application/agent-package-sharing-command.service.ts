import type { Agent, UpdateAgentPackageSharingInput } from "@mosoo/contracts/agent";
import { agentsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureAgentDestructiveAccess } from "./agent-access.service";
import { appendAgentAuditEvent } from "./agent-command-audit.service";
import { toAgentModel } from "./agent-models";
import { getAgentRow } from "./agent-repository";
import { parseAgentStoredConfig, serializeAgentStoredConfig } from "./agent-stored-config.service";

export async function updateAgentPackageSharing(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateAgentPackageSharingInput,
): Promise<Agent> {
  const editable = await ensureAgentDestructiveAccess(database, viewer.id, input.agentId);
  const stored = parseAgentStoredConfig(editable.agent.configJson);
  const timestampMs = currentTimestampMs();
  const configJson = serializeAgentStoredConfig({
    ...stored,
    packageSharingEnabled: input.packageSharingEnabled,
  });

  await getAppDatabase(database)
    .update(agentsTable)
    .set({
      configJson,
      updatedAt: timestampMs,
    })
    .where(eq(agentsTable.id, editable.agent.id))
    .run();

  await appendAgentAuditEvent(database, {
    agent: editable.agent,
    metadata: {
      kind: "package_sharing",
    },
    operationName: "updateAgentPackageSharing",
    viewer,
    viewerRole: editable.viewerRole,
  });

  return toAgentModel(database, viewer, await getAgentRow(database, editable.agent.id));
}
