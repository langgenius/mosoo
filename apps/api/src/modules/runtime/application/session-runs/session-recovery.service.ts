import type { SessionId } from "@mosoo/id";

import { API_ERROR_CODE, createApiError } from "../../../../platform/errors";
import { getSessionRecoveryExpiresAt } from "../../infrastructure/session-runs/session-recovery-retention.repository";

export async function assertSessionRecoveryAvailable(
  database: D1Database,
  sessionId: SessionId,
  now: number,
): Promise<void> {
  const expiresAt = await getSessionRecoveryExpiresAt(database, sessionId);
  if (expiresAt !== null && expiresAt <= now) {
    throw createApiError(
      API_ERROR_CODE.sessionRecoveryExpired,
      `Session recovery expired at ${new Date(expiresAt).toISOString()}. History and saved artifacts remain readable. Create a new Session to start new work.`,
    );
  }
}
