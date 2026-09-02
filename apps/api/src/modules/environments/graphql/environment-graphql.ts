import type { EnvironmentId, ProjectId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { environmentGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  createEnvironment,
  createEnvironmentFork,
  deleteEnvironment,
  getEnvironmentDetail,
  listProjectEnvironments,
  setEnvironmentVariableValue,
  setProjectDefaultEnvironment,
  updateEnvironment,
} from "../application/environment.service";

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

interface CreateEnvironmentForkArgs {
  input: Parameters<typeof createEnvironmentFork>[2];
}

interface DeleteEnvironmentArgs {
  input: Parameters<typeof deleteEnvironment>[2];
}

interface SetProjectDefaultEnvironmentArgs {
  input: Parameters<typeof setProjectDefaultEnvironment>[2];
}

interface SetEnvironmentVariableValueArgs {
  input: Parameters<typeof setEnvironmentVariableValue>[2];
}

export const environmentGraphQLModule = {
  ...environmentGraphQLSpec,
  authenticatedMutationResolvers: {
    createEnvironment: async (_parent, args: CreateEnvironmentArgs, context) =>
      createEnvironment(context.bindings, context.viewer, args.input),
    createEnvironmentFork: async (_parent, args: CreateEnvironmentForkArgs, context) =>
      createEnvironmentFork(context.bindings, context.viewer, args.input),
    deleteEnvironment: async (_parent, args: DeleteEnvironmentArgs, context) => {
      await deleteEnvironment(context.bindings, context.viewer, args.input);
      return { ok: true } as const;
    },
    setEnvironmentVariableValue: async (_parent, args: SetEnvironmentVariableValueArgs, context) =>
      setEnvironmentVariableValue(context.bindings, context.viewer, args.input),
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
