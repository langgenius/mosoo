import type { EnvironmentId, AppId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { environmentGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  createEnvironment,
  createEnvironmentFork,
  deleteEnvironment,
  getEnvironmentDetail,
  listAppEnvironments,
  setEnvironmentVariableValue,
  setAppDefaultEnvironment,
  updateEnvironment,
} from "../application/environment.service";

interface EnvironmentIdArgs {
  environmentId: EnvironmentId;
  appId: AppId;
}

interface AppIdArgs {
  appId: AppId;
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

interface SetAppDefaultEnvironmentArgs {
  input: Parameters<typeof setAppDefaultEnvironment>[2];
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
    setAppDefaultEnvironment: async (_parent, args: SetAppDefaultEnvironmentArgs, context) =>
      setAppDefaultEnvironment(context.bindings, context.viewer, args.input),
    updateEnvironment: async (_parent, args: UpdateEnvironmentArgs, context) =>
      updateEnvironment(context.bindings, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    environment: async (_parent, args: EnvironmentIdArgs, context) =>
      getEnvironmentDetail(context.bindings, context.viewer, {
        environmentId: args.environmentId,
        appId: args.appId,
      }),
    appEnvironmentList: async (_parent, args: AppIdArgs, context) =>
      listAppEnvironments(context.bindings, context.viewer, args.appId),
  },
} satisfies GraphQLModule;
