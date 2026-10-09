import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { getViewer, updateProfile } from "../application/viewer-context.service";

interface UpdateProfileArgs {
  input: Parameters<typeof updateProfile>[2];
}

export const userGraphQLModule = {
  authenticatedMutationResolvers: {
    updateProfile: async (_parent, args: UpdateProfileArgs, context) =>
      updateProfile(context.bindings.DB, context.viewer, args.input),
  },
  queryResolvers: {
    viewer: async (_parent, _args, context) => getViewer(context.bindings.DB, context.viewer),
  },
} satisfies GraphQLModule;
