import {
  FILE_STATUSES,
  type FileEntryListing,
  type FileListQuery as FileListRequest,
  type FileEntry,
  type FileStatus,
} from "@mosoo/contracts/file";

import { graphql } from "@/gql";
import type { FileListQuery as FileListGraphQLQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toFileId } from "@/routes/typed-id";

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
        status
        updatedAt
        version
      }
    }
  }
`);

type FileRecordNode = FileListGraphQLQuery["fileList"]["files"][number];

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

function toFileEntry(file: FileRecordNode): FileEntry {
  return {
    createdAt: file.createdAt,
    createdBy: toAccountId(file.createdBy),
    etag: file.etag,
    expiresAt: file.expiresAt,
    id: toFileId(file.id),
    mimeType: file.mimeType,
    name: file.name,
    path: file.path,
    sessionKind: file.sessionKind,
    size: file.size,
    status: toFileStatus(file.status),
    updatedAt: file.updatedAt,
    version: file.version,
  };
}

export async function listFiles(input: FileListRequest): Promise<FileEntryListing> {
  const payload = await requestGraphQL(FILE_LIST_QUERY, { input });

  return {
    files: payload.fileList.files.map(toFileEntry),
  };
}
