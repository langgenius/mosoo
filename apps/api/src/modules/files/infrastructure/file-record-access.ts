import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AppId } from "@mosoo/id";

import { ensureAppOwnership } from "../../apps/application/app.service";
import { createFileNotFoundError } from "./file-errors";
import type {
  FileAccessRequest,
  FileRecordRow,
  FileUploadContext,
  UploadAccessRequest,
} from "./file-record-model";
import { getFileRecordById } from "./file-record-queries";
import { getFileUploadAccessContextByFileId } from "./file-upload-context-store";
import { ensureSessionFileAccess } from "./session-file-ownership";

async function ensureAgentPackageFileAccess(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
  createdBy: AccountId,
  resourceKind: "file" | "upload",
): Promise<void> {
  await ensureAppOwnership(database, viewerId, appId);

  if (createdBy !== viewerId) {
    throw createFileNotFoundError(
      resourceKind === "file" ? "File not found." : "Upload not found.",
    );
  }
}

function requireScopeId(scopeId: string | null, label: string): string {
  if (scopeId === null) {
    throw createFileNotFoundError(`${label} not found.`);
  }

  return scopeId;
}

function ensureLibraryFileOwner(
  viewerId: AccountId,
  file: FileRecordRow,
  resourceKind: "file" | "upload",
): void {
  if (file.owner_kind !== "account" || file.owner_id !== viewerId) {
    throw createFileNotFoundError(
      resourceKind === "file" ? "File not found." : "Upload not found.",
    );
  }
}

export async function ensureUploadAccess({
  database,
  fileId,
  viewer,
}: UploadAccessRequest): Promise<FileUploadContext> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const context = await getFileUploadAccessContextByFileId(database, fileId, viewerId);

  if (!context) {
    throw createFileNotFoundError("Upload not found.");
  }

  if (context.upload.scope_kind === "library") {
    ensureLibraryFileOwner(viewerId, context.file, "upload");
  } else if (context.upload.scope_kind === "session") {
    if (!context.sessionAccess) {
      throw createFileNotFoundError("Session not found.");
    }
  } else if (
    context.upload.scope_kind === "agent_package" ||
    context.upload.scope_kind === "app_draft"
  ) {
    await ensureAgentPackageFileAccess(
      database,
      viewerId,
      parsePlatformId<AppId>(requireScopeId(context.upload.scope_id, "Upload"), "upload app ID"),
      context.upload.created_by_account_id,
      "upload",
    );
  } else {
    throw createFileNotFoundError("Upload not found.");
  }

  return context;
}

export async function ensureFileAccess({
  database,
  fileId,
  viewer,
}: FileAccessRequest): Promise<FileRecordRow> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const file = await getFileRecordById(database, fileId);

  if (!file) {
    throw createFileNotFoundError("File not found.");
  }

  if (file.scope_kind === "library") {
    ensureLibraryFileOwner(viewerId, file, "file");
  } else if (file.scope_kind === "session") {
    await ensureSessionFileAccess(
      database,
      viewerId,
      parsePlatformId(requireScopeId(file.scope_id, "File"), "file session ID"),
    );
  } else if (file.scope_kind === "agent_package" || file.scope_kind === "app_draft") {
    await ensureAgentPackageFileAccess(
      database,
      viewerId,
      parsePlatformId<AppId>(requireScopeId(file.scope_id, "File"), "file app ID"),
      file.created_by_account_id,
      "file",
    );
  } else {
    throw createFileNotFoundError("File not found.");
  }

  return file;
}
