import { parsePlatformId } from "@mosoo/id";
import type { AppId, SpaceId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { spaceGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  createSpaceDirectory,
  deleteSpaceEntry,
  getSpaceFiles,
} from "../application/space-file.service";
import {
  createSpace,
  deleteSpace,
  getSpace,
  listAppSpaces,
  updateSpace,
} from "../application/space.service";

interface SpacesArgs {
  appId: string;
}

interface SpaceArgs {
  appId: string;
  spaceId: string;
}

interface SpaceFilesArgs {
  path?: string;
  appId: string;
  spaceId: string;
}

interface CreateSpaceArgs {
  input: Parameters<typeof createSpace>[2];
}

interface UpdateSpaceArgs {
  input: Parameters<typeof updateSpace>[2];
}

interface CreateSpaceDirectoryArgs {
  input: Parameters<typeof createSpaceDirectory>[2];
}

interface DeleteSpaceEntryArgs {
  input: Parameters<typeof deleteSpaceEntry>[2];
}

export const spaceGraphQLModule = {
  ...spaceGraphQLSpec,
  authenticatedMutationResolvers: {
    createSpace: async (_parent, args: CreateSpaceArgs, context) =>
      createSpace(context.bindings.DB, context.viewer, args.input),
    createSpaceDirectory: async (_parent, args: CreateSpaceDirectoryArgs, context) =>
      createSpaceDirectory(context.bindings.DB, context.viewer, args.input),
    deleteSpace: async (_parent, args: SpaceArgs, context) => {
      const appId: AppId = parsePlatformId(args.appId, "app ID");
      const spaceId: SpaceId = parsePlatformId(args.spaceId, "space ID");
      await deleteSpace(context.bindings, context.viewer, appId, spaceId);
      return { ok: true } as const;
    },
    deleteSpaceEntry: async (_parent, args: DeleteSpaceEntryArgs, context) => {
      await deleteSpaceEntry(context.bindings, context.viewer, args.input);
      return { ok: true } as const;
    },
    updateSpace: async (_parent, args: UpdateSpaceArgs, context) =>
      updateSpace(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    space: async (_parent, args: SpaceArgs, context) => {
      const appId: AppId = parsePlatformId(args.appId, "app ID");
      const spaceId: SpaceId = parsePlatformId(args.spaceId, "space ID");
      return getSpace(context.bindings.DB, context.viewer, appId, spaceId);
    },
    spaceFiles: async (_parent, args: SpaceFilesArgs, context) => {
      const appId: AppId = parsePlatformId(args.appId, "app ID");
      const spaceId: SpaceId = parsePlatformId(args.spaceId, "space ID");
      return getSpaceFiles(context.bindings, context.viewer, appId, spaceId, args.path);
    },
    spaceList: async (_parent, args: SpacesArgs, context) => {
      const appId: AppId = parsePlatformId(args.appId, "app ID");
      return listAppSpaces(context.bindings.DB, context.viewer, appId);
    },
  },
} satisfies GraphQLModule;
