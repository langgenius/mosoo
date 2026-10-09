import { getAgentSessionUserLifecycleProjection } from "@mosoo/contracts/session";
import type { AccountId, ProjectId, SessionId } from "@mosoo/id";

import { findProjectSession } from "../../sessions/domain/session-access.policy";
import type { ProjectSessionRow } from "../../sessions/domain/session-access.policy";
import { createFileConflictError, createFileNotFoundError } from "./file-errors";
import type { FileAccessIntent } from "./file-record-model";

export async function ensureSessionFileAccess(
  database: D1Database,
  viewerId: AccountId,
  input: { projectId?: ProjectId; sessionId: SessionId },
  requiredIntent: FileAccessIntent,
): Promise<ProjectSessionRow> {
  const session = await findProjectSession(database, viewerId, input);

  if (session === null) {
    throw createFileNotFoundError("Session not found.");
  }

  if (requiredIntent === "write") {
    const lifecycle = getAgentSessionUserLifecycleProjection({
      archivedAt: session.archived_at,
      status: session.status,
    });

    if (lifecycle.readOnly) {
      throw createFileConflictError(lifecycle.recoverability.reason ?? "Session is read-only.");
    }
  }

  return session;
}
