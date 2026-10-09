import type { SessionStatus } from "@mosoo/contracts/session";
import { sandboxBackupsTable, sandboxSessionsTable, sessionsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { SandboxBackupId, SandboxId, SessionId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";

export interface SandboxSessionBackupCandidate {
  readonly cwd: string;
  readonly lastMessageAt: number | null;
  readonly sessionId: SessionId;
  readonly sessionStatus: SessionStatus;
}

export async function listSandboxSessionBackupCandidates(
  database: D1Database,
  sandboxId: string,
): Promise<SandboxSessionBackupCandidate[]> {
  const parsedSandboxId = parsePlatformId<SandboxId>(sandboxId, "sandbox id");
  const results = await getAppDatabase(database)
    .select({
      cwd: sandboxSessionsTable.cwd,
      last_message_at: sessionsTable.lastMessageAt,
      session_id: sandboxSessionsTable.sessionId,
      session_status: sessionsTable.status,
    })
    .from(sandboxSessionsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sandboxSessionsTable.sessionId))
    .where(
      and(
        eq(sandboxSessionsTable.sandboxId, parsedSandboxId),
        inArray(sandboxSessionsTable.status, ["active", "closed"]),
      ),
    )
    .all();

  return results.map((row) => ({
    cwd: row.cwd,
    lastMessageAt: row.last_message_at,
    sessionId: row.session_id,
    sessionStatus: row.session_status,
  }));
}

export async function listSandboxBackupIdsByDir(
  database: D1Database,
  dir: string,
): Promise<SandboxBackupId[]> {
  const results = await getAppDatabase(database)
    .select({ id: sandboxBackupsTable.id })
    .from(sandboxBackupsTable)
    .where(eq(sandboxBackupsTable.dir, dir))
    .all();

  return results.map((backup) => backup.id);
}

export async function deleteSandboxBackupRecordsForDir(
  database: D1Database,
  dir: string,
): Promise<void> {
  await getAppDatabase(database)
    .delete(sandboxBackupsTable)
    .where(eq(sandboxBackupsTable.dir, dir))
    .run();
}
