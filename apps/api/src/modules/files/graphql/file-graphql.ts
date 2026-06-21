import type {
  FileListQuery,
  FileScopeId,
  FileScopeKind,
  FileSessionKind,
} from "@mosoo/contracts/file";
import { parsePlatformId } from "@mosoo/id";
import type { AppId, SessionId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { fileGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { fileStore } from "../application/file-store";

interface FileListArgs {
  input: {
    appId: string;
    scopeId?: string | null;
    scopeKind?: FileScopeKind | null;
    sessionId?: string | null;
    sessionKind?: FileSessionKind | null;
  };
}

function toFileListQuery(input: FileListArgs["input"]): FileListQuery {
  return {
    appId: parsePlatformId<AppId>(input.appId, "file list app ID"),
    ...(input.scopeId === undefined || input.scopeId === null
      ? {}
      : {
          scopeId: parsePlatformId(input.scopeId, "file scope ID") as Exclude<FileScopeId, null>,
        }),
    ...(input.scopeKind === undefined || input.scopeKind === null
      ? {}
      : { scopeKind: input.scopeKind }),
    ...(input.sessionId === undefined || input.sessionId === null
      ? {}
      : {
          sessionId: parsePlatformId<SessionId>(input.sessionId, "file list session ID"),
        }),
    ...(input.sessionKind === undefined ? {} : { sessionKind: input.sessionKind }),
  };
}

export const fileGraphQLModule = {
  ...fileGraphQLSpec,
  authenticatedQueryResolvers: {
    fileList: async (_parent, args: FileListArgs, context) =>
      fileStore.list(context.bindings, context.viewer, toFileListQuery(args.input)),
  },
} satisfies GraphQLModule;
