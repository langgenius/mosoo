import type {
  CreateFileUploadRequest,
  CreateFileUploadResponse,
  FilePurpose,
  FileUploadStrategy,
} from "@mosoo/contracts/file";
import { fileRecordsTable, fileUploadsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, UploadId } from "@mosoo/id";

import { logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  FileControlError,
  createFileConflictError,
  createFileInvalidRequestError,
  createFileNotFoundError,
  createFilePreconditionFailedError,
} from "./file-errors";
import {
  choosePartSize,
  chooseUploadStrategy,
  createStagingObjectKey,
  normalizeContentType,
} from "./file-paths";
import {
  ensureUploadAccess,
  expirePathLocks,
  expireUploadIfNeeded,
  getPendingFileByPath,
  getReadyFileByPath,
  toUploadSummary,
} from "./file-record-store";
import type { FileRecordRow } from "./file-record-store";
import { getFileScopeDescriptor, resolveFileUploadTargetContext } from "./file-scope-descriptor";
import { createMultipartUpload, normalizeR2Etag } from "./r2-s3-client";

const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface FileUploadOverwriteState {
  ifMatchEtag: string | null;
  overwrite: boolean;
}

function resolveFileUploadPurpose(input: CreateFileUploadRequest): FilePurpose {
  const expectedPurpose = getFileScopeDescriptor(input.target.kind).uploadPurpose;

  if (input.purpose !== expectedPurpose) {
    throw createFileInvalidRequestError(
      `File purpose ${input.purpose} cannot be used with ${input.target.kind} target.`,
    );
  }

  return input.purpose;
}

function resolveFileUploadOverwriteState(
  input: CreateFileUploadRequest,
  existingReady: FileRecordRow | null,
): FileUploadOverwriteState {
  const overwrite = input.overwrite === true;
  const ifMatchEtag = normalizeR2Etag(input.ifMatchEtag);

  if (existingReady !== null && !overwrite) {
    throw new FileControlError(
      409,
      "file_conflict",
      "A file with this path already exists.",
      false,
      {
        currentEtag: existingReady.etag,
      },
    );
  }

  if (ifMatchEtag !== null && !overwrite) {
    throw createFileInvalidRequestError("ifMatchEtag requires overwrite.");
  }

  if (overwrite && ifMatchEtag !== null && existingReady === null) {
    throw createFileNotFoundError("File was deleted by someone else.");
  }

  if (overwrite && ifMatchEtag !== null && normalizeR2Etag(existingReady?.etag) !== ifMatchEtag) {
    throw createFilePreconditionFailedError("File was changed by someone else, please refresh.");
  }

  return { ifMatchEtag, overwrite };
}

async function createMultipartUploadId(
  bindings: ApiBindings,
  input: {
    contentType: string;
    objectKey: string;
    strategy: FileUploadStrategy;
  },
): Promise<string | null> {
  if (input.strategy !== "multipart") {
    return null;
  }

  const multipartUpload = await createMultipartUpload(bindings, input.objectKey, input.contentType);
  return multipartUpload.uploadId;
}

function validateUploadSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw createFileInvalidRequestError("File size must be a non-negative integer.");
  }
}

export async function createFileUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateFileUploadRequest,
): Promise<CreateFileUploadResponse> {
  validateUploadSize(input.file.size);

  const timestampMs = currentTimestampMs();
  const uploadId = createPlatformId<UploadId>();
  const fileId = createPlatformId<FileId>();
  const contentType = normalizeContentType(input.file.contentType);
  const strategy = chooseUploadStrategy(input.file.size);
  const partSize = strategy === "multipart" ? choosePartSize(input.file.size) : null;
  const expiresAt = timestampMs + UPLOAD_SESSION_TTL_MS;
  const purpose = resolveFileUploadPurpose(input);

  const { logicalPath, name, ownerId, ownerKind, parentPath, scopeId, scopeKind, sessionKind } =
    await resolveFileUploadTargetContext({
      bindings,
      fileId,
      target: input.target,
      viewer,
    });
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");

  if (getFileScopeDescriptor(scopeKind).capabilities.pathLocks) {
    await expirePathLocks({
      database: bindings.DB,
      path: logicalPath,
      scopeId,
      scopeKind,
    });
  }

  if (
    await getPendingFileByPath({
      database: bindings.DB,
      path: logicalPath,
      scopeId,
      scopeKind,
    })
  ) {
    throw createFileConflictError("A pending upload already exists for this path.");
  }

  const existingReady = await getReadyFileByPath({
    database: bindings.DB,
    path: logicalPath,
    scopeId,
    scopeKind,
  });

  const { ifMatchEtag, overwrite } = resolveFileUploadOverwriteState(input, existingReady);

  const stagingObjectKey = createStagingObjectKey(scopeKind, scopeId, fileId);
  const multipartUploadId = await createMultipartUploadId(bindings, {
    contentType,
    objectKey: stagingObjectKey,
    strategy,
  });

  await getAppDatabase(bindings.DB)
    .insert(fileRecordsTable)
    .values({
      committed: false,
      createdAt: timestampMs,
      createdByAccountId: viewerId,
      etag: null,
      expiresAt,
      id: fileId,
      mimeType: contentType,
      name,
      objectKey: stagingObjectKey,
      ownerId,
      ownerKind,
      parentPath,
      path: logicalPath,
      purpose,
      scopeId,
      scopeKind,
      sessionKind,
      size: input.file.size,
      status: "pending",
      updatedAt: timestampMs,
      version: 1,
    })
    .run();

  await getAppDatabase(bindings.DB)
    .insert(fileUploadsTable)
    .values({
      contentType,
      createdAt: timestampMs,
      createdByAccountId: viewerId,
      expectedSize: input.file.size,
      expiresAt,
      fileId,
      id: uploadId,
      ifMatchEtag,
      multipartUploadId,
      overwrite,
      partSize,
      scopeId,
      scopeKind,
      status: "pending",
      strategy,
      updatedAt: timestampMs,
    })
    .run();

  logInfo("file.upload.created", {
    contentType,
    fileId,
    objectKey: stagingObjectKey,
    owner_id: ownerId,
    owner_kind: ownerKind,
    overwrite,
    path: logicalPath,
    purpose,
    scopeId,
    scopeKind,
    size: input.file.size,
    strategy,
    uploadId,
    viewerId,
  });

  const fileRow: FileRecordRow = {
    committed: 0,
    created_at: timestampMs,
    created_by_account_id: viewerId,
    etag: null,
    expires_at: expiresAt,
    id: fileId,
    mime_type: contentType,
    name,
    object_key: stagingObjectKey,
    owner_id: ownerId,
    owner_kind: ownerKind,
    parent_path: parentPath,
    path: logicalPath,
    purpose,
    scope_id: scopeId,
    scope_kind: scopeKind,
    session_kind: sessionKind,
    size: input.file.size,
    status: "pending",
    updated_at: timestampMs,
    version: 1,
  };

  return toUploadSummary(
    {
      content_type: contentType,
      created_at: timestampMs,
      created_by_account_id: viewerId,
      expected_size: input.file.size,
      expires_at: expiresAt,
      file_id: fileId,
      id: uploadId,
      if_match_etag: ifMatchEtag,
      multipart_upload_id: multipartUploadId,
      overwrite: overwrite ? 1 : 0,
      part_size: partSize,
      scope_id: scopeId,
      scope_kind: scopeKind,
      status: "pending",
      strategy,
      updated_at: timestampMs,
    },
    fileRow,
  );
}

export async function getFileUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
): Promise<CreateFileUploadResponse> {
  const context = await ensureUploadAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "write",
    viewer,
  });
  await expireUploadIfNeeded(bindings.DB, context);
  return toUploadSummary(context.upload, context.file);
}
