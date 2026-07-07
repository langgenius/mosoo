import { MAX_AGENT_PACKAGE_ARCHIVE_BYTES } from "@mosoo/agent-package";
import type { FileId, AppId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { AdmittedAgentPackageFile } from "../../files/application/file-store";
import { fileStore, normalizeFileName } from "../../files/application/file-store";

export const AGENT_PACKAGE_CONTENT_TYPE = "application/zip";

export interface CreatedAgentPackageFile {
  contentType: typeof AGENT_PACKAGE_CONTENT_TYPE;
  fileId: FileId;
  fileName: string;
  size: number;
}

function hasSupportedArchiveExtension(fileName: string, extension: string): boolean {
  return fileName.toLowerCase().endsWith(extension);
}

function assertAgentPackageFileSize(size: number): void {
  if (size > MAX_AGENT_PACKAGE_ARCHIVE_BYTES) {
    throw new Error("Agent package file is too large.");
  }
}

function assertArchiveFileName(input: {
  extension: ".agent" | ".zip";
  fileName: string;
  message: string;
}): string {
  const normalizedFileName = normalizeFileName(input.fileName);

  if (!hasSupportedArchiveExtension(normalizedFileName, input.extension)) {
    throw new Error(input.message);
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

async function createAgentPackageScopedArchiveFile(input: {
  archiveBytes: Uint8Array;
  bindings: ApiBindings;
  extension: ".agent" | ".zip";
  fileName: string;
  invalidFileNameMessage: string;
  appId: AppId;
  viewer: AuthenticatedViewer;
}): Promise<CreatedAgentPackageFile> {
  await ensureAppOwnership(input.bindings.DB, input.viewer.id, input.appId);
  assertAgentPackageFileSize(input.archiveBytes.byteLength);

  const fileName = assertArchiveFileName({
    extension: input.extension,
    fileName: input.fileName,
    message: input.invalidFileNameMessage,
  });
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

export async function createAgentPackageFile(input: {
  archiveBytes: Uint8Array;
  bindings: ApiBindings;
  fileName: string;
  appId: AppId;
  viewer: AuthenticatedViewer;
}): Promise<CreatedAgentPackageFile> {
  return createAgentPackageScopedArchiveFile({
    ...input,
    extension: ".agent",
    invalidFileNameMessage: "Agent package file must use .agent.",
  });
}

export async function createAgentNativeRepoFile(input: {
  archiveBytes: Uint8Array;
  bindings: ApiBindings;
  fileName: string;
  appId: AppId;
  viewer: AuthenticatedViewer;
}): Promise<CreatedAgentPackageFile> {
  return createAgentPackageScopedArchiveFile({
    ...input,
    extension: ".zip",
    invalidFileNameMessage: "Agent native repo export file must use .zip.",
  });
}

function assertPackageFileArchiveShape(file: AdmittedAgentPackageFile): void {
  if (!hasSupportedArchiveExtension(file.name, ".agent")) {
    throw new Error("Agent package file must use .agent.");
  }

  assertAgentPackageFileSize(file.size);
}

export async function readAgentPackageArchiveFile(input: {
  bindings: ApiBindings;
  fileId: FileId;
  appId: AppId;
  viewer: AuthenticatedViewer;
}): Promise<{ archiveBytes: Uint8Array; file: AdmittedAgentPackageFile }> {
  const file = await fileStore.admitAgentPackageFile(input.bindings, input.viewer, {
    appId: input.appId,
    fileId: input.fileId,
  });
  assertPackageFileArchiveShape(file);

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
