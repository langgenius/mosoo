import type { SessionStatus } from "@mosoo/contracts/session";
import { sessionsTable } from "@mosoo/db";
import type { RuntimeOperationId } from "@mosoo/id";
import { sql } from "drizzle-orm";

export function createSessionStatusTransitionPatch(input: {
  readonly operationId?: RuntimeOperationId | null;
  readonly status: SessionStatus;
  readonly timestampMs: number;
}) {
  return {
    status: input.status,
    statusOperationId: input.status === "RESCHEDULING" ? (input.operationId ?? null) : null,
    statusSeq: sql`${sessionsTable.statusSeq} + 1`,
    updatedAt: input.timestampMs,
  };
}
