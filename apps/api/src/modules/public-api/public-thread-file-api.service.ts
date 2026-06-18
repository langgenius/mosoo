import type { FileRecord } from "@mosoo/contracts/file";
import type { PublicThreadFile } from "@mosoo/contracts/public-api";
import type {
  CreatePublicThreadFileRequest,
  PublicThreadFileListResponse,
  PublicThreadFileResponse,
} from "@mosoo/contracts/public-api";
import { parsePlatformId } from "@mosoo/id";
import type { FileId, PublicThreadId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { FileControlError } from "../files/application/file-control-errors";
import { fileStore } from "../files/application/file-store";
import { publishSessionResourceDelete } from "../sessions/application/session-resource-events.service";
import { toBackingSessionId } from "./public-thread-ids";
import { admitPublicSessionCaller } from "./public-thread-session-query.service";

async function admitPublicThreadFileAccess(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
): Promise<SessionId> {
  await admitPublicSessionCaller(bindings.DB, caller, threadId);
  return toBackingSessionId(threadId);
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

function toPublicThreadFileFromRecord(file: FileRecord): PublicThreadFile {
  return {
    committed: true,
    createdAt: file.createdAt,
    id: parsePlatformId(file.id, "File ID") as FileId,
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
  const sessionId = await admitPublicThreadFileAccess(bindings, caller, threadId);
  return {
    files: (
      await fileStore.list(bindings, caller, {
        scopeId: sessionId,
        scopeKind: "session",
      })
    ).files.map(toPublicThreadFileFromRecord),
  };
}

export async function createPublicThreadFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
  input: CreatePublicThreadFileRequest,
): Promise<PublicThreadFileResponse> {
  const sessionId = await admitPublicThreadFileAccess(bindings, caller, threadId);
  const claimedFiles = await fileStore.claimToSession(bindings, caller, sessionId, [input.fileId]);
  const claimedFile = claimedFiles[0];

  return {
    file: toPublicThreadFileFromRecord(
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
  const sessionId = await admitPublicThreadFileAccess(bindings, caller, input.threadId);
  const file = await fileStore.getRecord(bindings, caller, input.fileId);

  assertPublicThreadFile(file, sessionId);

  await fileStore.delete(bindings, caller, input.fileId);
  await publishSessionResourceDelete({
    bindings,
    resourceId: input.fileId,
    sessionId,
  });
}
