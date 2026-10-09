import type { FileScopeKind, FileSessionKind } from "@mosoo/contracts/file";
import type { ProjectId, SessionId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { fileStore } from "../application/file-store";

interface FileListArgs {
  input: {
    projectId: ProjectId;
    scopeKind?: FileScopeKind | null;
    sessionId?: SessionId | null;
    sessionKind?: FileSessionKind | null;
  };
}

export const fileGraphQLModule = {
  authenticatedQueryResolvers: {
    fileList: async (_parent, { input }: FileListArgs, context) =>
      fileStore.list(context.bindings, context.viewer, {
        projectId: input.projectId,
        ...(input.scopeKind == null ? {} : { scopeKind: input.scopeKind }),
        ...(input.sessionId == null ? {} : { sessionId: input.sessionId }),
        ...(input.sessionKind === undefined ? {} : { sessionKind: input.sessionKind }),
      }),
  },
} satisfies GraphQLModule;
