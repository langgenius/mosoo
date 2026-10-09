import type {
  CreateFileUploadRequest,
  CreateFileUploadResponse,
  CreateFileUploadTarget,
  FileOwnerId,
  FileOwnerKind,
  FilePurpose,
  FileScopeId,
  FileScopeKind,
  FileSessionKind,
} from "@mosoo/contracts/file";
import { getParentPath } from "@mosoo/contracts/file";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, ProjectId, UploadId } from "@mosoo/id";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { createFileConflictError, createFileInvalidRequestError } from "./file-errors";
import {
  choosePartSize,
  chooseUploadStrategy,
  createAccountAvatarPath,
  createAttachmentPath,
  createStagingObjectKey,
  normalizeContentType,
  normalizeFileName,
} from "./file-paths";
import { ensureProjectKeyFileScope, ensureUploadAccess } from "./file-record-access";
import { toUploadSummary } from "./file-record-model";
import { expireUploadIfNeeded } from "./file-record-mutations";
import { insertAdmittedFileUpload } from "./file-upload-admission.repository";
import { ensureSessionFileAccess } from "./session-file-ownership";

const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

interface FileUploadTarget {
  logicalPath: string;
  name: string;
  ownerId: FileOwnerId;
  ownerKind: FileOwnerKind;
  purpose: FilePurpose;
  scopeId: Exclude<FileScopeId, null>;
  scopeKind: FileScopeKind;
  sessionKind: FileSessionKind | null;
}

async function resolveFileUploadTarget(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  target: CreateFileUploadTarget,
): Promise<FileUploadTarget> {
  switch (target.kind) {
    case "account": {
      const accountId = parsePlatformId<AccountId>(target.id, "upload account ID");

      if (accountId !== viewer.id) {
        throw createFileInvalidRequestError(
          "Avatars can only be uploaded for the current account.",
        );
      }

      const name = normalizeFileName(target.name);

      return {
        logicalPath: createAccountAvatarPath(fileId, name),
        name,
        ownerId: accountId,
        ownerKind: "account",
        purpose: "account_avatar",
        scopeId: accountId,
        scopeKind: "account",
        sessionKind: null,
      };
    }
    case "session": {
      const projectId = parsePlatformId<ProjectId>(target.projectId, "upload session project ID");
      await ensureSessionFileAccess(
        bindings.DB,
        viewer.id,
        { projectId, sessionId: target.id },
        "view",
      );
      const name = normalizeFileName(target.name);

      return {
        logicalPath: createAttachmentPath(fileId, name),
        name,
        ownerId: target.id,
        ownerKind: "session",
        purpose: "session_attachment",
        scopeId: target.id,
        scopeKind: "session",
        sessionKind: "attachment",
      };
    }
    case "agent_package":
    case "app_draft": {
      const projectId = parsePlatformId<ProjectId>(target.id, "upload project ID");
      await ensureProjectOwnership(bindings.DB, viewer.id, projectId);
      const name = normalizeFileName(target.name);

      return {
        logicalPath: createAttachmentPath(fileId, name),
        name,
        ownerId: projectId,
        ownerKind: "app",
        purpose: target.kind,
        scopeId: projectId,
        scopeKind: target.kind,
        sessionKind: target.kind === "app_draft" ? "attachment" : null,
      };
    }
    default: {
      throw createFileInvalidRequestError("Unsupported file upload target.");
    }
  }
}

async function createMultipartUploadId(
  bindings: ApiBindings,
  input: {
    contentType: string;
    objectKey: string;
    strategy: "multipart" | "single_put";
  },
): Promise<string | null> {
  if (input.strategy !== "multipart") {
    return null;
  }

  const multipartUpload = await bindings.FILE_BUCKET.createMultipartUpload(input.objectKey, {
    httpMetadata: {
      contentType: input.contentType,
    },
  });
  return multipartUpload.uploadId;
}

export async function createFileUpload(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateFileUploadRequest,
): Promise<CreateFileUploadResponse> {
  if (!Number.isSafeInteger(input.file.size) || input.file.size < 0) {
    throw createFileInvalidRequestError("File size must be a non-negative integer.");
  }

  const timestampMs = currentTimestampMs();
  const uploadId = createPlatformId<UploadId>();
  const fileId = createPlatformId<FileId>();
  const contentType = normalizeContentType(input.file.contentType);
  const strategy = chooseUploadStrategy(input.file.size);
  const partSize = strategy === "multipart" ? choosePartSize(input.file.size) : null;
  const expiresAt = timestampMs + UPLOAD_SESSION_TTL_MS;
  const target = await resolveFileUploadTarget(bindings, viewer, fileId, input.target);

  if (input.purpose !== target.purpose) {
    throw createFileInvalidRequestError(
      `File purpose ${input.purpose} cannot be used with ${target.scopeKind} target.`,
    );
  }

  await ensureProjectKeyFileScope(bindings.DB, viewer, target.scopeKind, target.scopeId);

  const stagingObjectKey = createStagingObjectKey(target.scopeKind, target.scopeId, fileId);
  const multipartUploadId = await createMultipartUploadId(bindings, {
    contentType,
    objectKey: stagingObjectKey,
    strategy,
  });

  try {
    const admitted = await insertAdmittedFileUpload(
      bindings.DB,
      {
        committed: false,
        createdAt: timestampMs,
        createdByAccountId: viewer.id,
        etag: null,
        expiresAt,
        id: fileId,
        mimeType: contentType,
        name: target.name,
        objectKey: stagingObjectKey,
        ownerId: target.ownerId,
        ownerKind: target.ownerKind,
        parentPath: getParentPath(target.logicalPath),
        path: target.logicalPath,
        purpose: target.purpose,
        scopeId: target.scopeId,
        scopeKind: target.scopeKind,
        sessionKind: target.sessionKind,
        size: input.file.size,
        status: "pending",
        updatedAt: timestampMs,
        version: 1,
      },
      {
        contentType,
        createdAt: timestampMs,
        createdByAccountId: viewer.id,
        expectedSize: input.file.size,
        expiresAt,
        fileId,
        id: uploadId,
        multipartUploadId,
        overwrite: false,
        partSize,
        scopeId: target.scopeId,
        scopeKind: target.scopeKind,
        status: "pending",
        strategy,
        updatedAt: timestampMs,
      },
    );
    if (!admitted) {
      throw createFileConflictError(
        "Session no longer accepts uploads. Start a new Preview if it expired.",
      );
    }
  } catch (error) {
    if (multipartUploadId !== null) {
      await bindings.FILE_BUCKET.resumeMultipartUpload(stagingObjectKey, multipartUploadId)
        .abort()
        .catch((abortError: unknown) => {
          logWarn("file.upload.admission_abort_failed", {
            ...createErrorLogContext(abortError),
            fileId,
            uploadId,
          });
        });
    }
    throw error;
  }

  return toUploadSummary(
    {
      content_type: contentType,
      expected_size: input.file.size,
      expires_at: expiresAt,
      part_size: partSize,
      scope_kind: target.scopeKind,
      status: "pending",
      strategy,
    },
    { id: fileId, path: target.logicalPath },
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
