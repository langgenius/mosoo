import { parsePlatformId } from "@mosoo/id";
import type { OrganizationId, AppId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { appGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  deleteAppDeployment,
  deployApp,
  getAppDeploymentStatus,
} from "../application/app-deployment.service";
import { getAppOverview, getControlPlaneOverview } from "../application/app-overview.service";
import { createApp } from "../application/app-provisioning.service";
import { listOrganizationApps, renameApp } from "../application/app.service";

interface OrganizationIdArgs {
  organizationId: OrganizationId;
}

interface AppOverviewArgs {
  agentLimit?: number | null;
  appId: string;
  credentialLimit?: number | null;
}

interface ControlPlaneOverviewArgs {
  agentLimit?: number | null;
  appLimit?: number | null;
  credentialLimit?: number | null;
}

interface CreateAppArgs {
  input: {
    name: string;
    organizationId: OrganizationId;
  };
}

interface DeployAppArgs {
  input: Parameters<typeof deployApp>[2];
}

interface DeleteAppDeploymentArgs {
  input: Parameters<typeof deleteAppDeployment>[2];
}

interface RenameAppArgs {
  input: Parameters<typeof renameApp>[2];
}

function parseAppId(value: string): AppId {
  return parsePlatformId<AppId>(value, "App ID");
}

export const appGraphQLModule = {
  ...appGraphQLSpec,
  authenticatedMutationResolvers: {
    createApp: async (_parent, args: CreateAppArgs, context) =>
      createApp(context.bindings.DB, context.viewer, args.input),
    deleteAppDeployment: async (_parent, args: DeleteAppDeploymentArgs, context) =>
      deleteAppDeployment(context.bindings, context.viewer, args.input),
    deployApp: async (_parent, args: DeployAppArgs, context) =>
      deployApp(context.bindings, context.viewer, args.input),
    renameApp: async (_parent, args: RenameAppArgs, context) =>
      renameApp(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    appDeploymentStatus: async (_parent, args: { appId: string }, context) =>
      getAppDeploymentStatus(context.bindings, context.viewer, parseAppId(args.appId)),
    appList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationApps(context.bindings.DB, context.viewer, args.organizationId),
    appOverview: async (_parent, args: AppOverviewArgs, context) =>
      getAppOverview(context.bindings, context.viewer, {
        ...(args.agentLimit === undefined ? {} : { agentLimit: args.agentLimit }),
        appId: parseAppId(args.appId),
        ...(args.credentialLimit === undefined ? {} : { credentialLimit: args.credentialLimit }),
      }),
    controlPlaneOverview: async (_parent, args: ControlPlaneOverviewArgs, context) =>
      getControlPlaneOverview(context.bindings, context.viewer, {
        ...(args.agentLimit === undefined ? {} : { agentLimit: args.agentLimit }),
        ...(args.appLimit === undefined ? {} : { appLimit: args.appLimit }),
        ...(args.credentialLimit === undefined ? {} : { credentialLimit: args.credentialLimit }),
      }),
  },
} satisfies GraphQLModule;
