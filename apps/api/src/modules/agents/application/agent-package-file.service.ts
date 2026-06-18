import { MAX_AGENT_PACKAGE_ARCHIVE_BYTES } from "@mosoo/agent-package";
import { fileRecordsTable } from "@mosoo/db";
import type { AccountId, FileId, AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { fileStore, normalizeFileName } from "../../files/application/file-store";

export const AGENT_PACKAGE_CONTENT_TYPE = "application/zip";

export interface CreatedAgentPackageFile {
  contentType: typeof AGENT_PACKAGE_CONTENT_TYPE;
  fileId: FileId;
  fileName: string;
  size: number;
}

interface AgentPackageFileAdmissionRecord {
  createdBy: AccountId;
  expiresAtMs: number | null;
  id: FileId;
  name: string;
  ownerId: string;
  ownerKind: string;
  purpose: string;
  scopeId: string | null;
  scopeKind: string;
  size: number;
  status: string;
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

function createArchiveBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function abortPackageUploadForCompensation(input: {
  bindings: ApiBindings;
  fileId: FileId;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  await fileStore
    .abortUpload(input.bindings, input.viewer, input.fileId)
    .catch((error: unknown) => {
      logError("agent-package.file-cleanup.failed", {
        ...createErrorLogContext(error),
        fileId: input.fileId,
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

  const fileName = assertAgentPackageFileName(input.fileName);
  const upload = await fileStore.createUpload(input.bindings, input.viewer, {
    file: {
      contentType: AGENT_PACKAGE_CONTENT_TYPE,
      name: fileName,
      size: input.archiveBytes.byteLength,
    },
    purpose: "agent_package",
    target: {
      id: input.appId,
      kind: "agent_package",
      name: fileName,
    },
  });

  try {
    await fileStore.putContent(
      input.bindings,
      input.viewer,
      upload.fileId,
      createArchiveBody(input.archiveBytes),
    );
    const completed = await fileStore.completeUpload({
      bindings: input.bindings,
      fileId: upload.fileId,
      input: {},
      viewer: input.viewer,
    });

    return {
      contentType: AGENT_PACKAGE_CONTENT_TYPE,
      fileId: completed.file.id,
      fileName: completed.file.name,
      size: completed.file.size,
    };
  } catch (error) {
    await abortPackageUploadForCompensation({
      bindings: input.bindings,
      fileId: upload.fileId,
      viewer: input.viewer,
    });
    throw error;
  }
}

async function getAgentPackageFileAdmissionRecord(
  database: D1Database,
  fileId: FileId,
): Promise<AgentPackageFileAdmissionRecord | null> {
  return (
    (await getAppDatabase(database)
      .select({
        createdBy: fileRecordsTable.createdByAccountId,
        expiresAtMs: fileRecordsTable.expiresAt,
        id: fileRecordsTable.id,
        name: fileRecordsTable.name,
        ownerId: fileRecordsTable.ownerId,
        ownerKind: fileRecordsTable.ownerKind,
        purpose: fileRecordsTable.purpose,
        scopeId: fileRecordsTable.scopeId,
        scopeKind: fileRecordsTable.scopeKind,
        size: fileRecordsTable.size,
        status: fileRecordsTable.status,
      })
      .from(fileRecordsTable)
      .where(eq(fileRecordsTable.id, fileId))
      .limit(1)
      .get()) ?? null
  );
}

function assertPackageFileAdmitted(input: {
  file: AgentPackageFileAdmissionRecord;
  nowMs: number;
  appId: AppId;
  viewerId: AccountId;
}): void {
  const { file } = input;

  if (file.purpose !== "agent_package") {
    throw new Error("Agent package file purpose must be agent_package.");
  }

  if (file.scopeKind !== "agent_package") {
    throw new Error("Agent package file must use the agent_package scope.");
  }

  if (file.scopeId !== input.appId || file.ownerKind !== "app" || file.ownerId !== input.appId) {
    throw new Error("Agent package file does not belong to the target App.");
  }

  if (file.createdBy !== input.viewerId) {
    throw new Error("Agent package file does not belong to the importing user.");
  }

  if (file.status !== "ready") {
    throw new Error("Agent package file is not ready.");
  }

  if (file.expiresAtMs === null || file.expiresAtMs <= input.nowMs) {
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
}): Promise<{ archiveBytes: Uint8Array; file: AgentPackageFileAdmissionRecord }> {
  await ensureAppOwnership(input.bindings.DB, input.viewer.id, input.appId);

  const file = await getAgentPackageFileAdmissionRecord(input.bindings.DB, input.fileId);

  if (file === null) {
    throw new Error("Agent package file was not found.");
  }

  assertPackageFileAdmitted({
    file,
    nowMs: currentTimestampMs(),
    appId: input.appId,
    viewerId: input.viewer.id,
  });

  const response = await fileStore.streamContent(input.bindings, input.viewer, input.fileId);

  return {
    archiveBytes: new Uint8Array(await response.arrayBuffer()),
    file,
  };
}

export async function deleteImportedAgentPackageFile(input: {
  bindings: ApiBindings;
  fileId: FileId;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  await fileStore.delete(input.bindings, input.viewer, input.fileId).catch((error: unknown) => {
    logError("agent-package.import-package-delete.failed", {
      ...createErrorLogContext(error),
      fileId: input.fileId,
    });
  });
}
