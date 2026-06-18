import type {
  FileListQuery,
  FileScopeId,
  FileScopeKind,
  FileSessionKind,
} from "@mosoo/contracts/file";
import { parsePlatformId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { fileGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { fileStore } from "../application/file-store";

interface FileListArgs {
  input?: {
    scopeId?: string | null;
    scopeKind?: FileScopeKind | null;
    sessionKind?: FileSessionKind | null;
  } | null;
}

function toFileListQuery(input: FileListArgs["input"]): FileListQuery {
  if (input === undefined || input === null) {
    return {};
  }

  return {
    ...(input.scopeId === undefined || input.scopeId === null
      ? {}
      : {
          scopeId: parsePlatformId(input.scopeId, "File scope ID") as Exclude<FileScopeId, null>,
        }),
    ...(input.scopeKind === undefined || input.scopeKind === null
      ? {}
      : { scopeKind: input.scopeKind }),
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
