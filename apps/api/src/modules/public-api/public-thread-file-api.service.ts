import type { FileRecord } from "@mosoo/contracts/file";
import type { PublicThreadFile } from "@mosoo/contracts/public-api";
import type {
  CreatePublicThreadFileRequest,
  PublicThreadFileListResponse,
  PublicThreadFileResponse,
} from "@mosoo/contracts/public-api";
import type { SessionResource } from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";
import type { FileId, PublicThreadId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { claimAppDraftFilesToSession } from "../files/application/draft-file-claim.service";
import { createFileNotFoundError } from "../files/infrastructure/file-errors";
import { getFileRecordById, toFileRecord } from "../files/infrastructure/file-record-store";
import { listSessionResources } from "../sessions/application/session-resource.service";
import { toBackingSessionId } from "./public-thread-ids";
import { admitPublicSessionCaller } from "./public-thread-session-query.service";

function toPublicThreadFileFromResource(resource: SessionResource): PublicThreadFile {
  return {
    committed: true,
    createdAt: resource.createdAt,
    id: parsePlatformId(resource.id, "File ID") as FileId,
    kind: "attachment",
    mimeType: resource.mimeType,
    name: resource.name,
    size: resource.size,
  };
}

function toPublicThreadFileFromRecord(file: FileRecord): PublicThreadFile {
  return {
    committed: true,
    createdAt: file.createdAt,
    id: parsePlatformId(file.id, "File ID") as FileId,
    kind: "attachment",
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
  };
}

async function loadSessionResourceRemovalService() {
  return import("../sessions/application/session-resource-removal.service");
}

export async function listPublicThreadFiles(
  database: D1Database,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
): Promise<PublicThreadFileListResponse> {
  const sessionId = toBackingSessionId(threadId);
  const admission = await admitPublicSessionCaller(database, caller, threadId);
  return {
    files: (
      await listSessionResources(database, caller, {
        appId: admission.session.app_id,
        sessionId,
      })
    ).map(toPublicThreadFileFromResource),
  };
}

export async function createPublicThreadFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
  input: CreatePublicThreadFileRequest,
): Promise<PublicThreadFileResponse> {
  const sessionId = toBackingSessionId(threadId);
  const admission = await admitPublicSessionCaller(bindings.DB, caller, threadId);
  await claimAppDraftFilesToSession(bindings, caller, {
    attachmentIds: [input.fileId],
    appId: admission.session.app_id,
    sessionId,
  });
  const claimedFile = await getFileRecordById(bindings.DB, input.fileId);

  return {
    file: toPublicThreadFileFromRecord(
      claimedFile === null ? toFileRecordMissing(input.fileId) : toFileRecord(claimedFile),
    ),
  };
}

function toFileRecordMissing(fileId: FileId): never {
  throw createFileNotFoundError(`Thread file ${fileId} was not found after claim.`);
}

export async function deletePublicThreadFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    fileId: FileId;
    threadId: PublicThreadId;
  },
): Promise<void> {
  const sessionId = toBackingSessionId(input.threadId);
  const admission = await admitPublicSessionCaller(bindings.DB, caller, input.threadId);
  const { removeSessionResource } = await loadSessionResourceRemovalService();
  await removeSessionResource(
    bindings,
    caller,
    {
      appId: admission.session.app_id,
      resourceId: input.fileId,
      sessionId,
    },
    {
      authorization: "admitted",
    },
  );
}
