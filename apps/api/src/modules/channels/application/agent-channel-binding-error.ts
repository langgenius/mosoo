import { agentChannelBindingsTable, agentsTable } from "@mosoo/db";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { appendAuditEvent } from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import { getAgentChannelBindingProviderLabel } from "./agent-channel-binding-records";
import type { RecordAgentChannelBindingErrorInput } from "./agent-channel-binding.types";

export async function recordAgentChannelBindingError(
  database: D1Database,
  input: RecordAgentChannelBindingErrorInput,
): Promise<void> {
  const row = await getAppDatabase(database)
    .select({
      agentName: agentsTable.name,
      id: agentChannelBindingsTable.id,
      lastErrorCode: agentChannelBindingsTable.lastErrorCode,
      organizationId: agentsTable.organizationId,
      status: agentChannelBindingsTable.status,
    })
    .from(agentChannelBindingsTable)
    .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
    .where(
      and(
        eq(agentChannelBindingsTable.id, input.bindingId),
        eq(agentChannelBindingsTable.agentId, input.agentId),
        eq(agentChannelBindingsTable.provider, input.provider),
      ),
    )
    .limit(1)
    .get();

  if (!row) {
    return;
  }

  if (row.status === "error" && row.lastErrorCode === input.errorCode) {
    return;
  }

  const timestampMs = currentTimestampMs();
  await getAppDatabase(database)
    .update(agentChannelBindingsTable)
    .set({
      lastErrorCode: input.errorCode,
      status: "error",
      updatedAt: timestampMs,
    })
    .where(eq(agentChannelBindingsTable.id, input.bindingId))
    .run();

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.agentUpdate,
    actorDisplay: getAgentChannelBindingProviderLabel(input.provider),
    actorId: input.bindingId,
    actorMetadata: {
      binding_id: input.bindingId,
      provider: input.provider,
    },
    actorType: "system",
    metadata: {
      agentId: input.agentId,
      bindingId: input.bindingId,
      channel_binding_event: "error",
      error_code: input.errorCode,
      provider: input.provider,
    },
    organizationId: row.organizationId,
    outcome: "failure",
    resourceDisplay: row.agentName,
    resourceId: input.agentId,
    resourceType: AUDIT_RESOURCE.agent,
  });
}
