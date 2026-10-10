import { ORPCError } from "@orpc/server";

export function terminalConflict(input: {
  currentStatus: string | null;
  runId: string | null;
  sourceEventId?: string | null;
  reason: string;
}) {
  return new ORPCError("terminal_conflict", {
    status: 409,
    message: input.reason,
    data: {
      currentStatus: input.currentStatus,
      runId: input.runId,
      sourceEventId: input.sourceEventId ?? null,
    },
  });
}
