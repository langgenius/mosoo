import type { CreateFileUploadResponse } from "@mosoo/contracts/file";
import { toSessionResourceMaterializedPath } from "@mosoo/contracts/file";
import type {
  AddSessionResourceInput,
  RemoveSessionResourceInput,
  SessionResource,
} from "@mosoo/contracts/session";
import { fileRecordsTable, sessionsTable } from "@mosoo/db";
import type { AccountId, FileId, SessionId } from "@mosoo/id";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { sessionParticipantCondition } from "../../sessions/domain/session-access.policy";
import { deleteFileById } from "../infrastructure/file-content-service";
import { createFileConflictError, createFileNotFoundError } from "../infrastructure/file-errors";
import { ensureFileAccess } from "../infrastructure/file-record-store";
import { fileRecordRowColumns } from "../infrastructure/file-record-store";
import type { FileRecordRow } from "../infrastructure/file-record-store";
import { createFileUpload } from "../infrastructure/file-upload-create";

const SESSION_RESOURCE_LIMIT = 100;

interface JoinedSessionResourceRow {
  created_at: number | null;
  id: FileId | null;
  mime_type: string | null;
  name: string | null;
  path: string | null;
  size: number | null;
}

function toSessionResource(row: FileRecordRow): SessionResource {
  return {
    createdAt: toIsoString(row.created_at),
    id: row.id,
    mimeType: row.mime_type,
    name: row.name,
    path: toSessionResourceMaterializedPath(row.path),
    size: row.size,
  };
}

function requireJoinedSessionResourceValue<T>(value: T | null, fieldName: string): T {
  if (value === null) {
    throw createFileNotFoundError(`Session resource is missing ${fieldName}.`);
  }

  return value;
}

function toJoinedSessionResource(row: JoinedSessionResourceRow): SessionResource | null {
  if (row.id === null) {
    return null;
  }

  return {
    createdAt: toIsoString(requireJoinedSessionResourceValue(row.created_at, "created_at")),
    id: row.id,
    mimeType: row.mime_type,
    name: requireJoinedSessionResourceValue(row.name, "name"),
    path: toSessionResourceMaterializedPath(requireJoinedSessionResourceValue(row.path, "path")),
    size: requireJoinedSessionResourceValue(row.size, "size"),
  };
}

async function hasReachedSessionResourceLimit(
  database: D1Database,
  sessionId: SessionId,
): Promise<boolean> {
  const row =
    (await getAppDatabase(database)
      .select({ id: fileRecordsTable.id })
      .from(fileRecordsTable)
      .where(
        and(
          eq(fileRecordsTable.scopeKind, "session"),
          eq(fileRecordsTable.scopeId, sessionId),
          eq(fileRecordsTable.sessionKind, "attachment"),
          inArray(fileRecordsTable.status, ["pending", "ready"]),
        ),
      )
      .orderBy(asc(fileRecordsTable.id))
      .limit(1)
      .offset(SESSION_RESOURCE_LIMIT - 1)
      .get()) ?? null;

  return row !== null;
}

function enforceSessionResourceFile(file: FileRecordRow, input: RemoveSessionResourceInput): void {
  if (
    file.scope_kind !== "session" ||
    file.scope_id !== input.sessionId ||
    file.session_kind !== "attachment"
  ) {
    throw createFileNotFoundError("Session resource not found.");
  }
}

export async function createSessionResourceUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: AddSessionResourceInput,
): Promise<CreateFileUploadResponse> {
  if (await hasReachedSessionResourceLimit(bindings.DB, input.sessionId)) {
    throw createFileConflictError("Session File limit reached. Remove a file before uploading.");
  }

  return createFileUpload(bindings, viewer, {
    file: input.file,
    overwrite: false,
    purpose: "session_attachment",
    target: {
      id: input.sessionId,
      kind: "session",
      name: input.file.name,
      appId: input.appId,
    },
  });
}

export async function listSessionResourcesForSession(
  database: D1Database,
  sessionId: SessionId,
): Promise<SessionResource[]> {
  const results = await getAppDatabase(database)
    .select(fileRecordRowColumns)
    .from(fileRecordsTable)
    .where(
      and(
        eq(fileRecordsTable.scopeKind, "session"),
        eq(fileRecordsTable.scopeId, sessionId),
        eq(fileRecordsTable.sessionKind, "attachment"),
        eq(fileRecordsTable.status, "ready"),
      ),
    )
    .orderBy(desc(fileRecordsTable.id))
    .all();

  return results.map(toSessionResource);
}

export async function listSessionResourcesForParticipant(
  database: D1Database,
  viewerId: AccountId,
  sessionId: SessionId,
): Promise<SessionResource[]> {
  const rows = await getAppDatabase(database)
    .select({
      created_at: fileRecordsTable.createdAt,
      id: fileRecordsTable.id,
      mime_type: fileRecordsTable.mimeType,
      name: fileRecordsTable.name,
      path: fileRecordsTable.path,
      size: fileRecordsTable.size,
    })
    .from(sessionsTable)
    .leftJoin(
      fileRecordsTable,
      and(
        eq(fileRecordsTable.scopeKind, "session"),
        eq(fileRecordsTable.scopeId, sessionsTable.id),
        eq(fileRecordsTable.sessionKind, "attachment"),
        eq(fileRecordsTable.status, "ready"),
      ),
    )
    .where(and(eq(sessionsTable.id, sessionId), sessionParticipantCondition(viewerId)))
    .orderBy(desc(fileRecordsTable.id))
    .all();

  if (rows.length === 0) {
    throw forbiddenError();
  }

  return rows.flatMap((row) => {
    const resource = toJoinedSessionResource(row);
    return resource === null ? [] : [resource];
  });
}

export async function deleteSessionResource(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: RemoveSessionResourceInput,
): Promise<SessionResource> {
  const file = await ensureFileAccess({
    database: bindings.DB,
    fileId: input.resourceId,
    requiredRole: "edit",
    viewer,
  });

  enforceSessionResourceFile(file, input);
  await deleteFileById(bindings, viewer, input.resourceId);

  return toSessionResource(file);
}
