import type { FileRecord } from "@mosoo/contracts/file";
import type { PublishedThreadFile } from "@mosoo/contracts/public-api";
import type {
  CreatePublishedThreadFileRequest,
  PublishedThreadFileListResponse,
  PublishedThreadFileResponse,
} from "@mosoo/contracts/public-api";
import type { SessionResource } from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";
import type { FileId, PublicThreadId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { claimOrganizationDraftFilesToSession } from "../files/application/draft-file-claim.service";
import { createFileNotFoundError } from "../files/infrastructure/file-errors";
import { getFileRecordById, toFileRecord } from "../files/infrastructure/file-record-store";
import { listSessionResources } from "../sessions/application/session-resource.service";
import { admitPublicSessionCaller } from "./published-agent-session-query.service";
import { toBackingSessionId } from "./published-agent-thread-ids";

function toPublishedThreadFileFromResource(resource: SessionResource): PublishedThreadFile {
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

function toPublishedThreadFileFromRecord(file: FileRecord): PublishedThreadFile {
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

export async function listPublishedSessionFiles(
  database: D1Database,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
): Promise<PublishedThreadFileListResponse> {
  const sessionId = toBackingSessionId(threadId);
  await admitPublicSessionCaller(database, caller, threadId);
  return {
    files: (await listSessionResources(database, caller, sessionId)).map(
      toPublishedThreadFileFromResource,
    ),
  };
}

export async function createPublishedSessionFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  threadId: PublicThreadId,
  input: CreatePublishedThreadFileRequest,
): Promise<PublishedThreadFileResponse> {
  const sessionId = toBackingSessionId(threadId);
  const admission = await admitPublicSessionCaller(bindings.DB, caller, threadId);
  await claimOrganizationDraftFilesToSession(bindings, caller, {
    attachmentIds: [input.fileId],
    organizationId: admission.agent.organizationId,
    sessionId,
  });
  const claimedFile = await getFileRecordById(bindings.DB, input.fileId);

  return {
    file: toPublishedThreadFileFromRecord(
      claimedFile === null ? toFileRecordMissing(input.fileId) : toFileRecord(claimedFile),
    ),
  };
}

function toFileRecordMissing(fileId: FileId): never {
  throw createFileNotFoundError(`Thread file ${fileId} was not found after claim.`);
}

export async function deletePublishedSessionFile(
  bindings: ApiBindings,
  caller: AuthenticatedViewer,
  input: {
    fileId: FileId;
    threadId: PublicThreadId;
  },
): Promise<void> {
  const sessionId = toBackingSessionId(input.threadId);
  await admitPublicSessionCaller(bindings.DB, caller, input.threadId);
  const { removeSessionResource } = await loadSessionResourceRemovalService();
  await removeSessionResource(
    bindings,
    caller,
    {
      resourceId: input.fileId,
      sessionId,
    },
    {
      authorization: "admitted",
    },
  );
}
