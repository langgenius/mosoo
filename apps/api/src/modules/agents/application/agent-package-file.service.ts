import { MAX_AGENT_PACKAGE_ARCHIVE_BYTES } from "@mosoo/agent-package";
import type { FileId, ProjectId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { AdmittedAgentPackageFile } from "../../files/application/file-store";
import { fileStore, normalizeFileName } from "../../files/application/file-store";
import { ensureProjectOwnership } from "../../projects/application/project.service";

export const AGENT_PACKAGE_CONTENT_TYPE = "application/zip";

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
  projectId: ProjectId;
  viewer: AuthenticatedViewer;
}): Promise<CreatedAgentPackageFile> {
  await ensureProjectOwnership(input.bindings.DB, input.viewer.id, input.projectId);
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
      id: input.projectId,
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

function assertPackageFileArchiveShape(file: AdmittedAgentPackageFile): void {
  if (!isSupportedAgentPackageFileName(file.name)) {
    throw new Error("Agent package file must use .agent.");
  }

  assertAgentPackageFileSize(file.size);
}

export async function readAgentPackageArchiveFile(input: {
  bindings: ApiBindings;
  fileId: FileId;
  projectId: ProjectId;
  viewer: AuthenticatedViewer;
}): Promise<{ archiveBytes: Uint8Array; file: AdmittedAgentPackageFile }> {
  const file = await fileStore.admitAgentPackageFile(input.bindings, input.viewer, {
    projectId: input.projectId,
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
