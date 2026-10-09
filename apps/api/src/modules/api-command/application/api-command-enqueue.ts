import type { EnqueueApiCommandInput } from "./api-command-ledger";
import type { SessionRunDispatchCommandPayload } from "./api-command-payload";

export function createSessionRunDispatchApiCommandInput(
  payload: SessionRunDispatchCommandPayload,
): EnqueueApiCommandInput {
  return {
    dedupeKey: `session_run_dispatch:${payload.sessionRunId}`,
    kind: "session_run_dispatch",
    payload,
  };
}
