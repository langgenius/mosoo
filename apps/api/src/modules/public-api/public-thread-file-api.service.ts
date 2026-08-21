import type { FileEntry, FileRecord } from "@mosoo/contracts/file";
import { PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES } from "@mosoo/contracts/public-api";
import type {
  PublicFile,
  PublicFileResponse,
  PublicThreadFile,
  PublicThreadFileListResponse,
} from "@mosoo/contracts/public-api";
import { parsePlatformId } from "@mosoo/id";
import type { AgentId, AppId, FileId, PublicThreadId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { PublicApiCaller } from "../auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { FileControlError } from "../files/application/file-control-errors";
import { fileStore } from "../files/application/file-store";
import { publishSessionResourceDelete } from "../sessions/application/session-resource-events.service";
import { admitPublicThreadCreator } from "./public-thread-admission";
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

function toPublicFile(file: FileEntry | FileRecord): PublicFile {
  return {
    createdAt: file.createdAt,
    id: parsePlatformId<FileId>(file.id, "File ID"),
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
  };
}

async function admitPublicFileRecord(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  fileId: FileId,
): Promise<FileRecord> {
  const file = await fileStore.getRecord(bindings, caller, fileId);

  if (file.scope.kind === "session") {
    const threadId = requirePublicThreadFile(file);
    await admitPublicSessionCaller(bindings.DB, caller, threadId);
    return file;
  }

  if (file.scope.kind === "app_draft") {
    return file;
  }

  throw new FileControlError(404, "file_not_found", `File ${file.id} was not found.`);
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

export async function createPublicAgentFile(
  bindings: ApiBindings,
  caller: PublicApiCaller,
  input: {
    agentId: AgentId;
    file: File;
  },
): Promise<PublicFileResponse> {
  if (input.file.size > PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES) {
    throw new FileControlError(
      400,
      "file_invalid_request",
      `file.size must be ${PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES} bytes or fewer.`,
    );
  }

  const admission = await admitPublicThreadCreator(bindings.DB, caller, {
    agentId: input.agentId,
  });
  const upload = await fileStore.createUpload(bindings, admission.fileViewer, {
    file: {
      contentType: input.file.type || "application/octet-stream",
      name: input.file.name,
      size: input.file.size,
    },
    overwrite: false,
    purpose: "app_draft",
    target: {
      id: admission.appId,
      kind: "app_draft",
      name: input.file.name,
    },
  });

  await fileStore.putContent(bindings, admission.fileViewer, upload.fileId, input.file.stream());
  const completed = await fileStore.completeUpload({
    bindings,
    fileId: upload.fileId,
    input: {},
    viewer: admission.fileViewer,
  });

  return {
    file: toPublicFile(completed.file),
  };
}

export async function retrievePublicFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  fileId: FileId,
): Promise<PublicFileResponse> {
  const file = await admitPublicFileRecord(bindings, caller, fileId);
  return {
    file: toPublicFile(file),
  };
}

export async function claimPublicThreadFiles(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    fileIds: FileId[];
    threadId: PublicThreadId;
  },
): Promise<FileId[]> {
  if (input.fileIds.length === 0) {
    return [];
  }

  const { sessionId } = await admitPublicThreadFileAccess(bindings, caller, input.threadId);
  const claimedFiles = await fileStore.claimToSession(bindings, caller, sessionId, input.fileIds);

  return claimedFiles.map((file) => parsePlatformId<FileId>(file.id, "File ID"));
}

export async function deletePublicFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  fileId: FileId,
): Promise<void> {
  const file = await admitPublicFileRecord(bindings, caller, fileId);

  await fileStore.delete(bindings, caller, fileId);

  if (file.scope.kind === "session" && file.scope.id !== null) {
    await publishSessionResourceDelete({
      bindings,
      resourceId: fileId,
      sessionId: parsePlatformId<SessionId>(file.scope.id, "File session ID"),
    });
  }
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
