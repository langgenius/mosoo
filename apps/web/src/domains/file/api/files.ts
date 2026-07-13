import { FILE_STATUSES } from "@mosoo/contracts/file";
import type {
  FileEntry,
  FileListQuery as FileListRequest,
  FileStatus,
} from "@mosoo/contracts/file";
import type { SessionId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type { FileListQuery as FileListGraphQLQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toFileId, toSessionId } from "@/routes/typed-id";

const FILE_LIST_QUERY = graphql(/* GraphQL */ `
  query FileList($input: FileListInput!) {
    fileList(input: $input) {
      files {
        createdAt
        createdBy
        etag
        expiresAt
        id
        mimeType
        name
        path
        sessionKind
        size
        scope {
          id
          kind
        }
        status
        updatedAt
        version
      }
    }
  }
`);

type FileRecordNode = FileListGraphQLQuery["fileList"]["files"][number];

export interface ListedFileEntry extends FileEntry {
  sessionId: SessionId | null;
}

export interface ListedFileEntryListing {
  files: ListedFileEntry[];
}

export const fileKeys = {
  all: ["files"] as const,
  list: (input: FileListRequest) => [...fileKeys.lists(), input] as const,
  lists: () => [...fileKeys.all, "list"] as const,
};

function toFileStatus(status: string): FileStatus {
  if ((FILE_STATUSES as readonly string[]).includes(status)) {
    return status as FileStatus;
  }

  throw new Error(`Unknown file status: ${status}`);
}

function toFileSessionId(file: FileRecordNode): SessionId | null {
  if (file.scope.kind !== "session") {
    return null;
  }

  if (file.scope.id === null) {
    throw new Error("Session-scoped file is missing its Session id.");
  }

  return toSessionId(file.scope.id);
}

function toFileEntry(file: FileRecordNode): ListedFileEntry {
  return {
    createdAt: file.createdAt,
    createdBy: toAccountId(file.createdBy),
    etag: file.etag,
    expiresAt: file.expiresAt,
    id: toFileId(file.id),
    mimeType: file.mimeType,
    name: file.name,
    path: file.path,
    sessionId: toFileSessionId(file),
    sessionKind: file.sessionKind,
    size: file.size,
    status: toFileStatus(file.status),
    updatedAt: file.updatedAt,
    version: file.version,
  };
}

export async function listFiles(input: FileListRequest): Promise<ListedFileEntryListing> {
  const payload = await requestGraphQL(FILE_LIST_QUERY, { input });

  return {
    files: payload.fileList.files.map(toFileEntry),
  };
}
