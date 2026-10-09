import type { EnvironmentId, ProjectId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import {
  createEnvironment,
  deleteEnvironment,
  setProjectDefaultEnvironment,
  updateEnvironment,
} from "../application/environment-commands";
import { getEnvironmentDetail, listProjectEnvironments } from "../application/environment-queries";

interface EnvironmentIdArgs {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}

interface ProjectIdArgs {
  projectId: ProjectId;
}

interface CreateEnvironmentArgs {
  input: Parameters<typeof createEnvironment>[2];
}

interface UpdateEnvironmentArgs {
  input: Parameters<typeof updateEnvironment>[2];
}

interface DeleteEnvironmentArgs {
  input: Parameters<typeof deleteEnvironment>[2];
}

interface SetProjectDefaultEnvironmentArgs {
  input: Parameters<typeof setProjectDefaultEnvironment>[2];
}

export const environmentGraphQLModule = {
  authenticatedMutationResolvers: {
    createEnvironment: async (_parent, args: CreateEnvironmentArgs, context) =>
      createEnvironment(context.bindings, context.viewer, args.input),
    deleteEnvironment: async (_parent, args: DeleteEnvironmentArgs, context) => {
      await deleteEnvironment(context.bindings, context.viewer, args.input);
      return { ok: true } as const;
    },
    setProjectDefaultEnvironment: async (
      _parent,
      args: SetProjectDefaultEnvironmentArgs,
      context,
    ) => setProjectDefaultEnvironment(context.bindings, context.viewer, args.input),
    updateEnvironment: async (_parent, args: UpdateEnvironmentArgs, context) =>
      updateEnvironment(context.bindings, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    environment: async (_parent, args: EnvironmentIdArgs, context) =>
      getEnvironmentDetail(context.bindings, context.viewer, {
        environmentId: args.environmentId,
        projectId: args.projectId,
      }),
    projectEnvironmentList: async (_parent, args: ProjectIdArgs, context) =>
      listProjectEnvironments(context.bindings, context.viewer, args.projectId),
  },
} satisfies GraphQLModule;
