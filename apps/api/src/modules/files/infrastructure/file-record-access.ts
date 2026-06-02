import { parsePlatformId } from "@mosoo/id";
import type { AccountId } from "@mosoo/id";

import { createFileNotFoundError } from "./file-errors";
import type {
  FileAccessRequest,
  FileRecordRow,
  FileUploadContext,
  UploadAccessRequest,
} from "./file-record-model";
import { getFileRecordById } from "./file-record-queries";
import { getFileUploadAccessContextByFileId } from "./file-upload-context-store";
import {
  ensureOrganizationAvatarAccess,
  ensureOrganizationDraftOwnership,
} from "./organization-file-access";
import { ensureSessionFileAccess } from "./session-file-ownership";
import { ensureSpaceAccess } from "./space-access";

export async function ensureUploadAccess({
  database,
  fileId,
  requiredRole,
  viewer,
}: UploadAccessRequest): Promise<FileUploadContext> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const context = await getFileUploadAccessContextByFileId(database, fileId, viewerId);

  if (!context) {
    throw createFileNotFoundError("Upload not found.");
  }

  if (context.upload.scope_kind === "space") {
    await ensureSpaceAccess(
      database,
      viewerId,
      parsePlatformId(context.upload.scope_id, "upload space ID"),
      requiredRole,
    );
  } else if (context.upload.scope_kind === "session") {
    if (!context.sessionAccess) {
      throw createFileNotFoundError("Session not found.");
    }
  } else if (context.upload.scope_kind === "organization_avatar") {
    await ensureOrganizationAvatarAccess(
      database,
      viewerId,
      parsePlatformId(context.upload.scope_id, "upload organization ID"),
      requiredRole,
    );
  } else {
    await ensureOrganizationDraftOwnership(
      database,
      viewerId,
      parsePlatformId(context.upload.scope_id, "upload organization ID"),
      context.upload.created_by_account_id,
      "upload",
    );
  }

  return context;
}

export async function ensureFileAccess({
  database,
  fileId,
  requiredRole,
  viewer,
}: FileAccessRequest): Promise<FileRecordRow> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const file = await getFileRecordById(database, fileId);

  if (!file) {
    throw createFileNotFoundError("File not found.");
  }

  if (file.scope_kind === "space") {
    await ensureSpaceAccess(
      database,
      viewerId,
      parsePlatformId(file.scope_id, "file space ID"),
      requiredRole,
    );
  } else if (file.scope_kind === "session") {
    await ensureSessionFileAccess(
      database,
      viewerId,
      parsePlatformId(file.scope_id, "file session ID"),
    );
  } else if (file.scope_kind === "organization_avatar") {
    await ensureOrganizationAvatarAccess(
      database,
      viewerId,
      parsePlatformId(file.scope_id, "file organization ID"),
      requiredRole,
    );
  } else {
    await ensureOrganizationDraftOwnership(
      database,
      viewerId,
      parsePlatformId(file.scope_id, "file organization ID"),
      file.created_by_account_id,
      "file",
    );
  }

  return file;
}
