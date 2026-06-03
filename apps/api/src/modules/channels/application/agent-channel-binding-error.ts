import { agentChannelBindingsTable } from "@mosoo/db";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { RecordAgentChannelBindingErrorInput } from "./agent-channel-binding.types";

export async function recordAgentChannelBindingError(
  database: D1Database,
  input: RecordAgentChannelBindingErrorInput,
): Promise<void> {
  const row = await getAppDatabase(database)
    .select({
      lastErrorCode: agentChannelBindingsTable.lastErrorCode,
      status: agentChannelBindingsTable.status,
    })
    .from(agentChannelBindingsTable)
    .where(
      and(
        eq(agentChannelBindingsTable.id, input.bindingId),
        eq(agentChannelBindingsTable.agentId, input.agentId),
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
}
