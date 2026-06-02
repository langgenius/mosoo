import type { CompleteFileUploadRequest, CompleteFileUploadResponse } from "@mosoo/contracts/file";
import type { FileRecord } from "@mosoo/contracts/file";
import type { FileId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { completeFileUpload as completeFileUploadRecord } from "../infrastructure/file-upload-complete";

export interface CompleteFileUploadCommand {
  bindings: ApiBindings;
  fileId: FileId;
  input: CompleteFileUploadRequest;
  viewer: AuthenticatedViewer;
}

export { createFileUpload, getFileUpload } from "../infrastructure/file-upload-create";
export {
  abortFileUpload,
  uploadFileContent,
  uploadFilePart,
} from "../infrastructure/file-upload-transfer";
export { deleteFileById, streamFileContent } from "../infrastructure/file-content-service";
export {
  createFileErrorResponse,
  createUnexpectedFileError,
  FileControlError,
} from "../infrastructure/file-errors";
export { normalizeR2Etag } from "../infrastructure/r2-s3-client";
export { updateSpaceFile } from "../infrastructure/space-file-update";
export { acquireSpaceFileLock, releaseSpaceFileLock } from "../infrastructure/space-file-lock";

async function publishSessionResourceUpsert(
  bindings: ApiBindings,
  file: FileRecord,
): Promise<void> {
  const events = await import("../../sessions/application/session-resource-events.service");
  await events.publishSessionResourceUpsert(bindings, file);
}

export async function completeFileUpload(
  command: CompleteFileUploadCommand,
): Promise<CompleteFileUploadResponse> {
  const result = await completeFileUploadRecord(command);

  if (result.file.scope.kind === "session") {
    await publishSessionResourceUpsert(command.bindings, result.file);
  }

  return result;
}
