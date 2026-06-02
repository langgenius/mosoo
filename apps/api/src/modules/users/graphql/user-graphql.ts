import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { userGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  getViewer,
  setSystemAgentModel,
  updateProfile,
} from "../application/viewer-context.service";

interface SetSystemAgentModelArgs {
  input: Parameters<typeof setSystemAgentModel>[2];
}

interface UpdateProfileArgs {
  input: Parameters<typeof updateProfile>[2];
}

export const userGraphQLModule = {
  ...userGraphQLSpec,
  authenticatedMutationResolvers: {
    setSystemAgentModel: async (_parent, args: SetSystemAgentModelArgs, context) =>
      setSystemAgentModel(context.bindings.DB, context.viewer, args.input),
    updateProfile: async (_parent, args: UpdateProfileArgs, context) =>
      updateProfile(context.bindings.DB, context.viewer, args.input),
  },
  queryResolvers: {
    viewer: async (_parent, _args, context) =>
      getViewer(context.bindings.DB, context.bindings, context.viewer),
  },
} satisfies GraphQLModule;
