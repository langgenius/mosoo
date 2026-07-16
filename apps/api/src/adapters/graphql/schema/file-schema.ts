import { FILE_SESSION_KINDS } from "@mosoo/contracts/file";

import { graphQLEnumValues } from "./graphql-enum-values";

export const fileSchema = /* GraphQL */ `
  enum FileSessionKind {
    ${graphQLEnumValues(FILE_SESSION_KINDS)}
  }

  input FileListInput {
    appId: ULID!
    scopeId: ULID
    scopeKind: FileScopeKind
    sessionId: ULID
    sessionKind: FileSessionKind
  }

  type FileRecord {
    createdAt: String!
    createdBy: ULID!
    etag: String
    expiresAt: String
    id: ULID!
    mimeType: String
    name: String!
    owner: FileOwner!
    path: String!
    purpose: FilePurpose!
    scope: FileScope!
    sessionKind: FileSessionKind
    sourcePath: String
    size: Int!
    status: String!
    updatedAt: String!
    version: Int!
  }

  type FileListing {
    files: [FileRecord!]!
  }
`;
