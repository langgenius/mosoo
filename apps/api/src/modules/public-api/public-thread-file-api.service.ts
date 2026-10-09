import type { FileEntry, FileRecord } from "@mosoo/contracts/file";
import type {
  PublicApiVersion,
  PublicFile,
  PublicFileResponse,
  PublicThreadFile,
  PublicThreadFileListResponse,
} from "@mosoo/contracts/public-api";
import type { AgentId, ProjectId, FileId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { FileControlError, fileStore } from "../files/application/file-store";
import { publishSessionResourceDelete } from "../sessions/application/session-resource-events.service";
import { assertPreviewAvailable } from "../sessions/infrastructure/preview-retention.repository";
import { admitAgentApiEndpointCaller } from "./agent-api-endpoint-admission.service";
import { admitPublicProjectCaller } from "./public-thread-admission";
import { admitPublicThread } from "./public-thread-session-query.service";

function requirePublicThreadFile(file: FileRecord, sessionId?: SessionId): SessionId {
  if (
    file.scope.kind !== "session" ||
    file.scope.id === null ||
    (sessionId !== undefined && file.scope.id !== sessionId) ||
    (file.sessionKind !== "attachment" && file.sessionKind !== "artifact")
  ) {
    throw new FileControlError(404, "file_not_found", `Thread file ${file.id} was not found.`);
  }

  return file.scope.id as SessionId;
}

function toPublicThreadFile(file: FileEntry | FileRecord): PublicThreadFile {
  return {
    committed: true,
    createdAt: file.createdAt,
    id: file.id,
    kind: file.sessionKind ?? "attachment",
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
  };
}

function toPublicFile(file: FileEntry | FileRecord): PublicFile {
  return {
    createdAt: file.createdAt,
    id: file.id,
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
  };
}

async function admitPublicFileRecord(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  fileId: FileId,
  apiVersion: PublicApiVersion,
): Promise<FileRecord> {
  const file = await fileStore.getRecord(bindings, caller, fileId);

  if (file.scope.kind === "session") {
    await admitPublicThread(bindings.DB, caller, requirePublicThreadFile(file), apiVersion);
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
  threadId: SessionId,
  apiVersion: PublicApiVersion,
): Promise<PublicThreadFileListResponse> {
  const thread = await admitPublicThread(bindings.DB, caller, threadId, apiVersion);
  return {
    files: (
      await fileStore.list(bindings, caller, {
        projectId: thread.session.projectId,
        sessionId: threadId,
      })
    ).files.map(toPublicThreadFile),
  };
}

export async function createPublicAgentFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    file: File;
  },
  apiVersion: PublicApiVersion,
): Promise<PublicFileResponse> {
  return uploadPublicProjectFile(bindings, caller, {
    projectId: await admitAgentApiEndpointCaller(bindings.DB, caller, input.agentId, apiVersion),
    file: input.file,
  });
}

export async function createPublicProjectFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: { projectId: ProjectId; file: File },
): Promise<PublicFileResponse> {
  await admitPublicProjectCaller(bindings.DB, caller, input.projectId);
  return uploadPublicProjectFile(bindings, caller, input);
}

async function uploadPublicProjectFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: { projectId: ProjectId; file: File },
): Promise<PublicFileResponse> {
  const upload = await fileStore.createUpload(bindings, caller, {
    file: {
      contentType: input.file.type || "application/octet-stream",
      name: input.file.name,
      size: input.file.size,
    },
    purpose: "app_draft",
    target: {
      id: input.projectId,
      kind: "app_draft",
      name: input.file.name,
    },
  });

  await fileStore.putContent(bindings, caller, upload.fileId, input.file.stream());
  const completed = await fileStore.completeUpload({
    bindings,
    fileId: upload.fileId,
    input: {},
    viewer: caller,
  });

  return {
    file: toPublicFile(completed.file),
  };
}

export async function retrievePublicFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  fileId: FileId,
  apiVersion: PublicApiVersion,
): Promise<PublicFileResponse> {
  const file = await admitPublicFileRecord(bindings, caller, fileId, apiVersion);
  return {
    file: toPublicFile(file),
  };
}

/** Claims draft files into a Thread the caller has already been admitted to. */
export async function claimPublicThreadFiles(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    fileIds: FileId[];
    admissionRequestedAtMs: number;
    sessionId: SessionId;
  },
): Promise<FileId[]> {
  if (input.fileIds.length === 0) {
    return [];
  }

  await assertPreviewAvailable(bindings.DB, input.sessionId, input.admissionRequestedAtMs);
  const claimedFiles = await fileStore.claimToSession(
    bindings,
    caller,
    input.sessionId,
    input.fileIds,
  );

  return claimedFiles.map((file) => file.id);
}

export async function deletePublicFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  fileId: FileId,
  apiVersion: PublicApiVersion,
): Promise<void> {
  const file = await admitPublicFileRecord(bindings, caller, fileId, apiVersion);

  await fileStore.delete(bindings, caller, fileId);

  if (file.scope.kind === "session" && file.scope.id !== null) {
    await publishSessionResourceDelete({
      bindings,
      resourceId: fileId,
      sessionId: file.scope.id as SessionId,
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
  apiVersion: PublicApiVersion,
): Promise<Response> {
  const file = await fileStore.getRecord(bindings, caller, input.fileId);

  await admitPublicThread(bindings.DB, caller, requirePublicThreadFile(file), apiVersion);
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
    threadId: SessionId;
  },
  apiVersion: PublicApiVersion,
): Promise<void> {
  await admitPublicThread(bindings.DB, caller, input.threadId, apiVersion);
  requirePublicThreadFile(
    await fileStore.getRecord(bindings, caller, input.fileId),
    input.threadId,
  );

  await fileStore.delete(bindings, caller, input.fileId);
  await publishSessionResourceDelete({
    bindings,
    resourceId: input.fileId,
    sessionId: input.threadId,
  });
}
