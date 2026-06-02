import type { EnvironmentId, OrganizationId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { environmentGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  createEnvironment,
  createEnvironmentFork,
  deleteEnvironment,
  getEnvironmentDetail,
  listOrganizationEnvironments,
  setEnvironmentVariableValue,
  setOrganizationDefaultEnvironment,
  shareEnvironmentWithOrganization,
  shareEnvironmentWithUser,
  unshareEnvironmentTarget,
  updateEnvironment,
} from "../application/environment.service";

interface EnvironmentIdArgs {
  environmentId: EnvironmentId;
}

interface OrganizationIdArgs {
  organizationId: OrganizationId;
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

interface SetOrganizationDefaultEnvironmentArgs {
  input: Parameters<typeof setOrganizationDefaultEnvironment>[2];
}

interface SetEnvironmentVariableValueArgs {
  input: Parameters<typeof setEnvironmentVariableValue>[2];
}

interface ShareEnvironmentWithUserArgs {
  input: Parameters<typeof shareEnvironmentWithUser>[2];
}

interface ShareEnvironmentWithOrganizationArgs {
  input: Parameters<typeof shareEnvironmentWithOrganization>[2];
}

interface UnshareEnvironmentTargetArgs {
  input: Parameters<typeof unshareEnvironmentTarget>[2];
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
    setOrganizationDefaultEnvironment: async (
      _parent,
      args: SetOrganizationDefaultEnvironmentArgs,
      context,
    ) => setOrganizationDefaultEnvironment(context.bindings, context.viewer, args.input),
    shareEnvironmentWithOrganization: async (
      _parent,
      args: ShareEnvironmentWithOrganizationArgs,
      context,
    ) => shareEnvironmentWithOrganization(context.bindings, context.viewer, args.input),
    shareEnvironmentWithUser: async (_parent, args: ShareEnvironmentWithUserArgs, context) =>
      shareEnvironmentWithUser(context.bindings, context.viewer, args.input),
    unshareEnvironmentTarget: async (_parent, args: UnshareEnvironmentTargetArgs, context) => {
      await unshareEnvironmentTarget(context.bindings, context.viewer, args.input);
      return { ok: true } as const;
    },
    updateEnvironment: async (_parent, args: UpdateEnvironmentArgs, context) =>
      updateEnvironment(context.bindings, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    environment: async (_parent, args: EnvironmentIdArgs, context) =>
      getEnvironmentDetail(context.bindings, context.viewer, args.environmentId),
    organizationEnvironmentList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationEnvironments(context.bindings, context.viewer, args.organizationId),
  },
} satisfies GraphQLModule;
