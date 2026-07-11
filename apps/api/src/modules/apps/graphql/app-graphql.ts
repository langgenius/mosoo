import { parsePlatformId } from "@mosoo/id";
import type { OrganizationId, AppId } from "@mosoo/id";

import type { AuthenticatedGraphQLContext } from "../../../adapters/graphql/graphql-context";
import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { appGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getAppOverview, getControlPlaneOverview } from "../application/app-overview.service";
import { createApp } from "../application/app-provisioning.service";
import { listOrganizationApps, renameApp } from "../application/app.service";
import {
  createAppVibeApp,
  createAppVibeAppCloneUrl,
  deleteAppVibeApp,
  getAppVibeApp,
  publishAppVibeApp,
  refreshAppVibeAppPreview,
  sendAppVibeAppPrompt,
} from "../application/vibe-app.service";
import { createVibesdkGateway, createVibesdkGatewayForRead } from "../application/vibesdk-gateway";
import type { VibesdkGateway } from "../application/vibesdk-gateway";

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

interface RenameAppArgs {
  input: Parameters<typeof renameApp>[2];
}

function parseAppId(value: string): AppId {
  return parsePlatformId<AppId>(value, "App ID");
}

// Every vibe app resolver has the same shape: App ownership plus the shared
// VibeSDK gateway, keyed by the mutation input.
function vibeAppResolver<TInput, TResult>(
  handler: (
    database: D1Database,
    gateway: VibesdkGateway | null,
    viewer: AuthenticatedViewer,
    input: TInput,
  ) => Promise<TResult>,
) {
  return async (_parent: unknown, args: { input: TInput }, context: AuthenticatedGraphQLContext) =>
    handler(
      context.bindings.DB,
      createVibesdkGateway(context.bindings),
      context.viewer,
      args.input,
    );
}

export const appGraphQLModule = {
  ...appGraphQLSpec,
  authenticatedMutationResolvers: {
    createApp: async (_parent, args: CreateAppArgs, context) =>
      createApp(context.bindings.DB, context.viewer, args.input),
    createAppVibeApp: vibeAppResolver(createAppVibeApp),
    createAppVibeAppCloneUrl: vibeAppResolver(createAppVibeAppCloneUrl),
    deleteAppVibeApp: vibeAppResolver(deleteAppVibeApp),
    publishAppVibeApp: vibeAppResolver(publishAppVibeApp),
    refreshAppVibeAppPreview: vibeAppResolver(refreshAppVibeAppPreview),
    renameApp: async (_parent, args: RenameAppArgs, context) =>
      renameApp(context.bindings.DB, context.viewer, args.input),
    sendAppVibeAppPrompt: vibeAppResolver(sendAppVibeAppPrompt),
  },
  authenticatedQueryResolvers: {
    appList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationApps(context.bindings.DB, context.viewer, args.organizationId),
    appOverview: async (_parent, args: AppOverviewArgs, context) =>
      getAppOverview(context.bindings.DB, context.viewer, {
        ...(args.agentLimit === undefined ? {} : { agentLimit: args.agentLimit }),
        appId: parseAppId(args.appId),
        ...(args.credentialLimit === undefined ? {} : { credentialLimit: args.credentialLimit }),
      }),
    appVibeApp: async (_parent, args: { appId: string }, context) =>
      getAppVibeApp(
        context.bindings.DB,
        createVibesdkGatewayForRead(context.bindings),
        context.viewer,
        parseAppId(args.appId),
      ),
    appVibeAppEnabled: async (_parent, _args, context) =>
      createVibesdkGatewayForRead(context.bindings) !== null,
    controlPlaneOverview: async (_parent, args: ControlPlaneOverviewArgs, context) =>
      getControlPlaneOverview(context.bindings.DB, context.viewer, {
        ...(args.agentLimit === undefined ? {} : { agentLimit: args.agentLimit }),
        ...(args.appLimit === undefined ? {} : { appLimit: args.appLimit }),
        ...(args.credentialLimit === undefined ? {} : { credentialLimit: args.credentialLimit }),
      }),
  },
} satisfies GraphQLModule;
