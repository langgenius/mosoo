import { MAX_AGENT_PACKAGE_ARCHIVE_BYTES } from "@mosoo/agent-package";
import { getParentPath } from "@mosoo/contracts/file";
import { fileRecordsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, FileId, AppId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  deleteObject,
  getObjectBody,
  putObject,
} from "../../files/application/file-object-storage.service";
import {
  createAttachmentPath,
  createFinalObjectKey,
  normalizeFileName,
} from "../../files/application/file-path.service";
import { getFileRecordById } from "../../files/application/file-record-read.service";
import type { FileRecordRow } from "../../files/application/file-record-read.service";
import { deleteFileById } from "../../files/infrastructure/file-content-service";

const AGENT_PACKAGE_FILE_TTL_MS = 24 * 60 * 60 * 1000;
export const AGENT_PACKAGE_CONTENT_TYPE = "application/zip";

type FileRecordInsert = typeof fileRecordsTable.$inferInsert;

export interface CreatedAgentPackageFile {
  contentType: typeof AGENT_PACKAGE_CONTENT_TYPE;
  fileId: FileId;
  fileName: string;
  size: number;
}

function isSupportedAgentPackageFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".agent");
}

function assertAgentPackageFileSize(size: number): void {
  if (size > MAX_AGENT_PACKAGE_ARCHIVE_BYTES) {
    throw new Error("Agent package file is too large.");
  }
}

function assertAgentPackageFileName(fileName: string): string {
  const normalizedFileName = normalizeFileName(fileName);

  if (!isSupportedAgentPackageFileName(normalizedFileName)) {
    throw new Error("Agent package file must use .agent.");
  }

  return normalizedFileName;
}

function createPackageRecordShape(input: {
  createdBy: AccountId;
  fileId: FileId;
  fileName: string;
  appId: AppId;
}) {
  const path = createAttachmentPath(input.fileId, input.fileName);

  return {
    created_by_account_id: input.createdBy,
    id: input.fileId,
    name: input.fileName,
    path,
    scope_id: input.appId,
    scope_kind: "agent_package" as const,
  };
}

function toRecordValues(input: {
  contentType: string;
  createdBy: AccountId;
  etag: string;
  expiresAt: number | null;
  fileId: FileId;
  fileName: string;
  objectKey: string;
  purpose: "agent_asset" | "agent_package";
  appId: AppId;
  size: number;
  timestampMs: number;
}): FileRecordInsert {
  const path = createAttachmentPath(input.fileId, input.fileName);

  return {
    committed: false,
    createdAt: input.timestampMs,
    createdByAccountId: input.createdBy,
    etag: input.etag,
    expiresAt: input.expiresAt,
    id: input.fileId,
    mimeType: input.contentType,
    name: input.fileName,
    objectKey: input.objectKey,
    ownerId: input.appId,
    ownerKind: "app",
    parentPath: getParentPath(path),
    path,
    purpose: input.purpose,
    scopeId: input.appId,
    scopeKind: "agent_package",
    sessionKind: null,
    size: input.size,
    status: "ready",
    updatedAt: input.timestampMs,
    version: 1,
  };
}

async function deleteObjectForCompensation(input: {
  bindings: ApiBindings;
  context: Record<string, string>;
  objectKey: string;
}): Promise<void> {
  await deleteObject(input.bindings, input.objectKey).catch((error: unknown) => {
    logError("agent-package.file-cleanup.failed", {
      ...createErrorLogContext(error),
      ...input.context,
      objectKey: input.objectKey,
    });
  });
}

export async function createAgentPackageFile(input: {
  archiveBytes: Uint8Array;
  bindings: ApiBindings;
  fileName: string;
  appId: AppId;
  viewer: AuthenticatedViewer;
}): Promise<CreatedAgentPackageFile> {
  await ensureAppOwnership(input.bindings.DB, input.viewer.id, input.appId);
  assertAgentPackageFileSize(input.archiveBytes.byteLength);

  const fileId = createPlatformId<FileId>();
  const fileName = assertAgentPackageFileName(input.fileName);
  const timestampMs = currentTimestampMs();
  const recordShape = createPackageRecordShape({
    createdBy: input.viewer.id,
    fileId,
    fileName,
    appId: input.appId,
  });
  const objectKey = createFinalObjectKey(recordShape);
  const head = await putObject({
    bindings: input.bindings,
    body: input.archiveBytes,
    contentType: AGENT_PACKAGE_CONTENT_TYPE,
    objectKey,
    options: {
      ifNoneMatch: "*",
    },
  });
  const values = toRecordValues({
    contentType: AGENT_PACKAGE_CONTENT_TYPE,
    createdBy: input.viewer.id,
    etag: head.etag,
    expiresAt: timestampMs + AGENT_PACKAGE_FILE_TTL_MS,
    fileId,
    fileName,
    objectKey,
    purpose: "agent_package",
    appId: input.appId,
    size: head.contentLength,
    timestampMs,
  });

  try {
    await getAppDatabase(input.bindings.DB).insert(fileRecordsTable).values(values).run();
  } catch (error) {
    await deleteObjectForCompensation({
      bindings: input.bindings,
      context: {
        fileId,
        appId: input.appId,
      },
      objectKey,
    });
    throw error;
  }

  return {
    contentType: AGENT_PACKAGE_CONTENT_TYPE,
    fileId,
    fileName,
    size: head.contentLength,
  };
}

function assertPackageFileAdmitted(input: {
  file: FileRecordRow;
  nowMs: number;
  appId: AppId;
  viewerId: AccountId;
}): void {
  const { file } = input;

  if (file.purpose !== "agent_package") {
    throw new Error("Agent package file purpose must be agent_package.");
  }

  if (file.scope_kind !== "agent_package") {
    throw new Error("Agent package file must use the agent_package scope.");
  }

  if (file.scope_id !== input.appId || file.owner_kind !== "app" || file.owner_id !== input.appId) {
    throw new Error("Agent package file does not belong to the target App.");
  }

  if (file.created_by_account_id !== input.viewerId) {
    throw new Error("Agent package file does not belong to the importing user.");
  }

  if (file.status !== "ready") {
    throw new Error("Agent package file is not ready.");
  }

  if (file.expires_at === null || file.expires_at <= input.nowMs) {
    throw new Error("Agent package file is expired.");
  }

  if (!isSupportedAgentPackageFileName(file.name)) {
    throw new Error("Agent package file must use .agent.");
  }

  assertAgentPackageFileSize(file.size);
}

export async function readAgentPackageArchiveFile(input: {
  bindings: ApiBindings;
  fileId: FileId;
  appId: AppId;
  viewer: AuthenticatedViewer;
}): Promise<{ archiveBytes: Uint8Array; file: FileRecordRow }> {
  await ensureAppOwnership(input.bindings.DB, input.viewer.id, input.appId);

  const file = await getFileRecordById(input.bindings.DB, input.fileId);

  if (file === null) {
    throw new Error("Agent package file was not found.");
  }

  assertPackageFileAdmitted({
    file,
    nowMs: currentTimestampMs(),
    appId: input.appId,
    viewerId: input.viewer.id,
  });

  const object = await getObjectBody(input.bindings, file.object_key);

  if (object === null) {
    throw new Error("Agent package file content was not found.");
  }

  return {
    archiveBytes: new Uint8Array(await object.arrayBuffer()),
    file,
  };
}

export async function deleteImportedAgentPackageFile(input: {
  bindings: ApiBindings;
  fileId: FileId;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  await deleteFileById(input.bindings, input.viewer, input.fileId).catch((error: unknown) => {
    logError("agent-package.import-package-delete.failed", {
      ...createErrorLogContext(error),
      fileId: input.fileId,
    });
  });
}
