import {
  FILE_STATUSES,
  type FileListQuery as FileListRequest,
  type FileListing,
  type FileOwner,
  type FileOwnerId,
  type FileRecord,
  type FileScope,
  type FileScopeId,
  type FileStatus,
} from "@mosoo/contracts/file";

import { graphql } from "@/gql";
import type { FileListQuery as FileListGraphQLQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toAppId, toFileId, toSessionId } from "@/routes/typed-id";

const FILE_LIST_QUERY = graphql(/* GraphQL */ `
  query FileList($input: FileListInput) {
    fileList(input: $input) {
      files {
        createdAt
        createdBy
        etag
        expiresAt
        id
        mimeType
        name
        owner {
          id
          kind
        }
        path
        purpose
        scope {
          id
          kind
        }
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

function toScopeId(scope: FileRecordNode["scope"]): FileScopeId {
  if (scope.id === null) {
    return null;
  }

  if (scope.kind === "session") {
    return toSessionId(scope.id);
  }

  return toAppId(scope.id);
}

function toOwnerId(owner: FileRecordNode["owner"]): FileOwnerId {
  if (owner.kind === "account") {
    return toAccountId(owner.id);
  }

  if (owner.kind === "session") {
    return toSessionId(owner.id);
  }

  return toAppId(owner.id);
}

function toFileScope(scope: FileRecordNode["scope"]): FileScope {
  return {
    id: toScopeId(scope),
    kind: scope.kind,
  };
}

function toFileOwner(owner: FileRecordNode["owner"]): FileOwner {
  return {
    id: toOwnerId(owner),
    kind: owner.kind,
  };
}

function toFileRecord(file: FileRecordNode): FileRecord {
  return {
    createdAt: file.createdAt,
    createdBy: toAccountId(file.createdBy),
    etag: file.etag,
    expiresAt: file.expiresAt,
    id: toFileId(file.id),
    mimeType: file.mimeType,
    name: file.name,
    owner: toFileOwner(file.owner),
    path: file.path,
    purpose: file.purpose,
    scope: toFileScope(file.scope),
    sessionKind: file.sessionKind,
    size: file.size,
    status: toFileStatus(file.status),
    updatedAt: file.updatedAt,
    version: file.version,
  };
}

export async function listFiles(input: FileListRequest): Promise<FileListing> {
  const payload = await requestGraphQL(FILE_LIST_QUERY, { input });

  return {
    files: payload.fileList.files.map(toFileRecord),
  };
}
