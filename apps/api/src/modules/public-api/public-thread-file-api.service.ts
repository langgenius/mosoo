import type {
  CompleteFileUploadRequest,
  CompleteFileUploadResponse,
  CreateFileUploadResponse,
  FileEntry,
  FileRecord,
} from "@mosoo/contracts/file";
import type { PublicThreadFile } from "@mosoo/contracts/public-api";
import type {
  CreatePublicThreadFileUploadRequest,
  CreatePublicThreadFileRequest,
  PublicThreadFileListResponse,
  PublicThreadFileResponse,
} from "@mosoo/contracts/public-api";
import { parsePlatformId } from "@mosoo/id";
import type { AppId, FileId, PublicThreadId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { FileControlError } from "../files/application/file-control-errors";
import { fileStore } from "../files/application/file-store";
import type { ContentBody } from "../files/application/file-store";
import { publishSessionResourceDelete } from "../sessions/application/session-resource-events.service";
import { toBackingSessionId, toPublicThreadId } from "./public-thread-ids";
import { admitPublicSessionCaller } from "./public-thread-session-query.service";

async function admitPublicThreadFileAccess(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
): Promise<{ appId: AppId; sessionId: SessionId }> {
  const admission = await admitPublicSessionCaller(bindings.DB, caller, threadId);
  return {
    appId: admission.session.app_id,
    sessionId: toBackingSessionId(threadId),
  };
}

function assertPublicThreadFile(file: FileRecord, sessionId: SessionId): void {
  if (
    file.scope.kind !== "session" ||
    file.scope.id !== sessionId ||
    (file.sessionKind !== "attachment" && file.sessionKind !== "artifact")
  ) {
    throw new FileControlError(404, "file_not_found", `Thread file ${file.id} was not found.`);
  }
}

function requirePublicThreadFile(file: FileRecord): PublicThreadId {
  if (
    file.scope.kind !== "session" ||
    file.scope.id === null ||
    (file.sessionKind !== "attachment" && file.sessionKind !== "artifact")
  ) {
    throw new FileControlError(404, "file_not_found", `Thread file ${file.id} was not found.`);
  }

  return toPublicThreadId(parsePlatformId<SessionId>(file.scope.id, "File session ID"));
}

function requirePublicThreadAttachment(file: FileRecord): PublicThreadId {
  if (file.sessionKind !== "attachment") {
    throw new FileControlError(404, "file_not_found", `Thread file ${file.id} was not found.`);
  }

  return requirePublicThreadFile(file);
}

function toPublicThreadFile(file: FileEntry | FileRecord): PublicThreadFile {
  return {
    committed: true,
    createdAt: file.createdAt,
    id: parsePlatformId<FileId>(file.id, "File ID"),
    kind: file.sessionKind ?? "attachment",
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
  };
}

export async function listPublicThreadFiles(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
): Promise<PublicThreadFileListResponse> {
  const { appId, sessionId } = await admitPublicThreadFileAccess(bindings, caller, threadId);
  return {
    files: (
      await fileStore.list(bindings, caller, {
        appId,
        sessionId,
      })
    ).files.map(toPublicThreadFile),
  };
}

export async function createPublicThreadFileUpload(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
  input: CreatePublicThreadFileUploadRequest,
): Promise<CreateFileUploadResponse> {
  const { appId, sessionId } = await admitPublicThreadFileAccess(bindings, caller, threadId);
  return fileStore.createSessionResourceUpload(bindings, caller, {
    appId,
    file: input.file,
    sessionId,
  });
}

export async function putPublicThreadFileContent(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    body: ContentBody;
    fileId: FileId;
  },
): Promise<void> {
  const file = await fileStore.getRecord(bindings, caller, input.fileId);
  const threadId = requirePublicThreadAttachment(file);

  await admitPublicSessionCaller(bindings.DB, caller, threadId);
  await fileStore.putContent(bindings, caller, input.fileId, input.body);
}

export async function completePublicThreadFileUpload(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    fileId: FileId;
    request: CompleteFileUploadRequest;
  },
): Promise<CompleteFileUploadResponse> {
  const file = await fileStore.getRecord(bindings, caller, input.fileId);
  const threadId = requirePublicThreadAttachment(file);

  await admitPublicSessionCaller(bindings.DB, caller, threadId);
  return fileStore.completeUpload({
    bindings,
    fileId: input.fileId,
    input: input.request,
    viewer: caller,
  });
}

export async function downloadPublicThreadFileContent(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    disposition: "attachment" | "inline";
    fileId: FileId;
  },
): Promise<Response> {
  const file = await fileStore.getRecord(bindings, caller, input.fileId);
  const threadId = requirePublicThreadFile(file);

  await admitPublicSessionCaller(bindings.DB, caller, threadId);
  const response = await fileStore.streamContent(bindings, caller, input.fileId, input.disposition);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function createPublicThreadFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
  input: CreatePublicThreadFileRequest,
): Promise<PublicThreadFileResponse> {
  const { sessionId } = await admitPublicThreadFileAccess(bindings, caller, threadId);
  const claimedFiles = await fileStore.claimToSession(bindings, caller, sessionId, [input.fileId]);
  const claimedFile = claimedFiles[0];

  return {
    file: toPublicThreadFile(
      claimedFile === undefined ? toFileRecordMissing(input.fileId) : claimedFile,
    ),
  };
}

function toFileRecordMissing(fileId: FileId): never {
  throw new FileControlError(
    404,
    "file_not_found",
    `Thread file ${fileId} was not found after claim.`,
  );
}

export async function deletePublicThreadFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    fileId: FileId;
    threadId: PublicThreadId;
  },
): Promise<void> {
  const { sessionId } = await admitPublicThreadFileAccess(bindings, caller, input.threadId);
  const file = await fileStore.getRecord(bindings, caller, input.fileId);

  assertPublicThreadFile(file, sessionId);

  await fileStore.delete(bindings, caller, input.fileId);
  await publishSessionResourceDelete({
    bindings,
    resourceId: input.fileId,
    sessionId,
  });
}
