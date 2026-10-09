import type { FileScopeKind } from "@mosoo/contracts/file";
import { fileRecordsTable, fileUploadsTable, sessionsTable } from "@mosoo/db";
import type { PlatformId, ProjectId, SessionId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/domain/authenticated-viewer";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { createFileNotFoundError } from "./file-errors";
import type {
  FileAccessIntent,
  FileAccessRequest,
  FileRecordRow,
  FileUploadContext,
} from "./file-record-model";
import { fileRecordRowColumns, fileUploadRowColumns } from "./file-record-model";
import { getFileRecordById } from "./file-record-queries";
import { ensureSessionFileAccess } from "./session-file-ownership";

export async function ensureProjectKeyFileScope(
  database: D1Database,
  viewer: AuthenticatedViewer,
  scopeKind: FileScopeKind,
  scopeId: PlatformId | null,
): Promise<void> {
  if (viewer.projectId === undefined) return;
  if (scopeKind === "session" && scopeId !== null) {
    const session = await getAppDatabase(database)
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.id, scopeId as SessionId),
          eq(sessionsTable.projectId, viewer.projectId),
        ),
      )
      .limit(1)
      .get();
    if (session) return;
  } else if (
    (scopeKind === "library" || scopeKind === "app_draft" || scopeKind === "agent_package") &&
    scopeId === viewer.projectId
  ) {
    return;
  }
  throw createFileNotFoundError("File not found.");
}

async function ensureFileRowAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  file: FileRecordRow,
  requiredIntent: FileAccessIntent,
  resource: "File" | "Upload",
): Promise<void> {
  await ensureProjectKeyFileScope(database, viewer, file.scope_kind, file.scope_id);

  switch (file.scope_kind) {
    case "account": {
      if (file.owner_kind !== "account" || file.owner_id !== viewer.id) {
        throw createFileNotFoundError(`${resource} not found.`);
      }
      return;
    }
    case "library": {
      if (file.owner_kind !== "app" || file.owner_id !== file.scope_id) {
        throw createFileNotFoundError(`${resource} not found.`);
      }
      await ensureProjectOwnership(database, viewer.id, file.scope_id as ProjectId);
      return;
    }
    case "session": {
      await ensureSessionFileAccess(
        database,
        viewer.id,
        { sessionId: file.scope_id as SessionId },
        requiredIntent,
      );
      return;
    }
    case "agent_package":
    case "app_draft": {
      await ensureProjectOwnership(database, viewer.id, file.scope_id as ProjectId);

      if (file.created_by_account_id !== viewer.id) {
        throw createFileNotFoundError(`${resource} not found.`);
      }
      return;
    }
    default: {
      throw createFileNotFoundError(`${resource} not found.`);
    }
  }
}

export async function ensureUploadAccess({
  database,
  fileId,
  requiredIntent,
  viewer,
}: FileAccessRequest): Promise<FileUploadContext> {
  const context =
    (await getAppDatabase(database)
      .select({ file: fileRecordRowColumns, upload: fileUploadRowColumns })
      .from(fileUploadsTable)
      .innerJoin(fileRecordsTable, eq(fileRecordsTable.id, fileUploadsTable.fileId))
      .where(eq(fileUploadsTable.fileId, fileId))
      .limit(1)
      .get()) ?? null;

  if (!context) {
    throw createFileNotFoundError("Upload not found.");
  }

  await ensureFileRowAccess(database, viewer, context.file, requiredIntent, "Upload");
  return context;
}

export async function ensureFileAccess({
  database,
  fileId,
  requiredIntent,
  viewer,
}: FileAccessRequest): Promise<FileRecordRow> {
  const file = await getFileRecordById(database, fileId);

  if (!file) {
    throw createFileNotFoundError("File not found.");
  }

  await ensureFileRowAccess(database, viewer, file, requiredIntent, "File");
  return file;
}
