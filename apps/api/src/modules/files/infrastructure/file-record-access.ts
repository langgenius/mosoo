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
import { ensureSpaceAccessBySpaceId } from "./space-access";

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

export async function ensureUploadAccess({
  database,
  fileId,
  requiredIntent,
  viewer,
}: UploadAccessRequest): Promise<FileUploadContext> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const context = await getFileUploadAccessContextByFileId(database, fileId, viewerId);

  if (!context) {
    throw createFileNotFoundError("Upload not found.");
  }

  if (context.upload.scope_kind === "space") {
    await ensureSpaceAccessBySpaceId(
      database,
      viewerId,
      parsePlatformId(context.upload.scope_id, "upload space ID"),
      requiredIntent,
    );
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
      parsePlatformId<AppId>(context.upload.scope_id, "upload app ID"),
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
  requiredIntent,
  viewer,
}: FileAccessRequest): Promise<FileRecordRow> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const file = await getFileRecordById(database, fileId);

  if (!file) {
    throw createFileNotFoundError("File not found.");
  }

  if (file.scope_kind === "space") {
    await ensureSpaceAccessBySpaceId(
      database,
      viewerId,
      parsePlatformId(file.scope_id, "file space ID"),
      requiredIntent,
    );
  } else if (file.scope_kind === "session") {
    await ensureSessionFileAccess(
      database,
      viewerId,
      parsePlatformId(file.scope_id, "file session ID"),
    );
  } else if (file.scope_kind === "agent_package" || file.scope_kind === "app_draft") {
    await ensureAgentPackageFileAccess(
      database,
      viewerId,
      parsePlatformId<AppId>(file.scope_id, "file app ID"),
      file.created_by_account_id,
      "file",
    );
  } else {
    throw createFileNotFoundError("File not found.");
  }

  return file;
}
