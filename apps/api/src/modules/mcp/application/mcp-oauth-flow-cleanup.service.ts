import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../time";
import {
  destroyOAuthFlowArtifactsBatch,
  listOAuthFlowsForCleanup,
  markOAuthFlowsExpiredBatch,
} from "./mcp-oauth-flow.repository";

export async function cleanupExpiredOAuthFlows(bindings: ApiBindings): Promise<void> {
  const now = currentTimestampMs();
  const flows = await listOAuthFlowsForCleanup(bindings.DB, {
    cleanupAfterLte: now,
    includePendingExpired: true,
  });
  const expiredPendingFlows = flows.filter(
    (flow) => flow.status === "pending" && flow.expiresAt <= now,
  );
  const removableFlows = flows.filter((flow) => flow.status !== "pending");

  await markOAuthFlowsExpiredBatch(bindings.DB, expiredPendingFlows);
  await destroyOAuthFlowArtifactsBatch(bindings.DB, removableFlows);
}
