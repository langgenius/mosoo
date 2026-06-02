import { toSessionResourceMaterializedPath } from "@mosoo/contracts/file";
import { fileRecordsTable } from "@mosoo/db";
import type { FileId, SessionId } from "@mosoo/id";
import { and, asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../../platform/db/drizzle";

export interface SessionResourcePathEntry {
  id: FileId;
  name: string;
  path: string;
  size: number;
}

export async function listSessionResourcePathEntries(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionResourcePathEntry[]> {
  const results = await getAppDatabase(database)
    .select({
      id: fileRecordsTable.id,
      name: fileRecordsTable.name,
      path: fileRecordsTable.path,
      size: fileRecordsTable.size,
    })
    .from(fileRecordsTable)
    .where(
      and(
        eq(fileRecordsTable.scopeKind, "session"),
        eq(fileRecordsTable.scopeId, sessionId),
        eq(fileRecordsTable.status, "ready"),
        eq(fileRecordsTable.sessionKind, "attachment"),
      ),
    )
    .orderBy(asc(fileRecordsTable.createdAt))
    .all();

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    path: toSessionResourceMaterializedPath(row.path),
    size: row.size,
  }));
}

function formatByteCount(bytes: number): string {
  return bytes === 1 ? "1 byte" : `${bytes} bytes`;
}

export function appendSessionResourceContextToPrompt(
  prompt: string,
  resources: readonly SessionResourcePathEntry[],
): string {
  if (resources.length === 0) {
    return prompt;
  }

  return [
    "Session files available to this turn:",
    "These files are persisted for this session and mounted read-only relative to the current working directory. Use the paths exactly as shown.",
    ...resources.map(
      (resource) => `- ${resource.path} (${resource.name}, ${formatByteCount(resource.size)})`,
    ),
    "",
    "User message:",
    prompt,
  ].join("\n");
}
