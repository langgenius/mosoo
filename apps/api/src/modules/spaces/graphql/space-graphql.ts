import { parsePlatformId } from "@mosoo/id";
import type { OrganizationId, SpaceId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { spaceGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  addCollaborator,
  addOrganizationCollaborator,
  getCollaborators,
  removeCollaborator,
  updateCollaborator,
} from "../application/space-collaborator.service";
import {
  createSpaceDirectory,
  deleteSpaceEntry,
  getSpaceFiles,
} from "../application/space-file.service";
import {
  createSpace,
  deleteSpace,
  getSpace,
  listVisibleSpaces,
  updateSpace,
} from "../application/space.service";

interface SpacesArgs {
  organizationId: string;
}

interface SpaceArgs {
  spaceId: string;
}

interface SpaceFilesArgs {
  path?: string;
  spaceId: string;
}

interface CreateSpaceArgs {
  input: Parameters<typeof createSpace>[2];
}

interface UpdateSpaceArgs {
  input: Parameters<typeof updateSpace>[2];
}

interface AddCollaboratorArgs {
  input: Parameters<typeof addCollaborator>[2];
}

interface AddOrganizationCollaboratorArgs {
  input: Parameters<typeof addOrganizationCollaborator>[2];
}

interface UpdateCollaboratorArgs {
  input: Parameters<typeof updateCollaborator>[2];
}

interface RemoveCollaboratorArgs {
  input: Parameters<typeof removeCollaborator>[2];
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
    addCollaborator: async (_parent, args: AddCollaboratorArgs, context) =>
      addCollaborator(context.bindings.DB, context.viewer, args.input),
    addOrganizationCollaborator: async (_parent, args: AddOrganizationCollaboratorArgs, context) =>
      addOrganizationCollaborator(context.bindings.DB, context.viewer, args.input),
    createSpace: async (_parent, args: CreateSpaceArgs, context) =>
      createSpace(context.bindings.DB, context.viewer, args.input),
    createSpaceDirectory: async (_parent, args: CreateSpaceDirectoryArgs, context) =>
      createSpaceDirectory(context.bindings.DB, context.viewer, args.input),
    deleteSpace: async (_parent, args: SpaceArgs, context) => {
      const spaceId: SpaceId = parsePlatformId(args.spaceId, "space ID");
      await deleteSpace(context.bindings, context.viewer, spaceId);
      return { ok: true } as const;
    },
    deleteSpaceEntry: async (_parent, args: DeleteSpaceEntryArgs, context) => {
      await deleteSpaceEntry(context.bindings, context.viewer, args.input);
      return { ok: true } as const;
    },
    removeCollaborator: async (_parent, args: RemoveCollaboratorArgs, context) => {
      await removeCollaborator(context.bindings.DB, context.viewer, args.input);
      return { ok: true } as const;
    },
    updateCollaborator: async (_parent, args: UpdateCollaboratorArgs, context) =>
      updateCollaborator(context.bindings.DB, context.viewer, args.input),
    updateSpace: async (_parent, args: UpdateSpaceArgs, context) =>
      updateSpace(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    space: async (_parent, args: SpaceArgs, context) => {
      const spaceId: SpaceId = parsePlatformId(args.spaceId, "space ID");
      return getSpace(context.bindings.DB, context.viewer, spaceId);
    },
    spaceCollaboratorList: async (_parent, args: SpaceArgs, context) => {
      const spaceId: SpaceId = parsePlatformId(args.spaceId, "space ID");
      return getCollaborators(context.bindings.DB, context.viewer, spaceId);
    },
    spaceFiles: async (_parent, args: SpaceFilesArgs, context) => {
      const spaceId: SpaceId = parsePlatformId(args.spaceId, "space ID");
      return getSpaceFiles(context.bindings, context.viewer, spaceId, args.path);
    },
    spaceList: async (_parent, args: SpacesArgs, context) => {
      const organizationId: OrganizationId = parsePlatformId(
        args.organizationId,
        "organization ID",
      );
      return listVisibleSpaces(context.bindings.DB, context.viewer, organizationId);
    },
  },
} satisfies GraphQLModule;
