import { parsePlatformId } from "@mosoo/id";
import type { OrganizationId, AppId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { appGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
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
import { createVibesdkGateway } from "../application/vibesdk-gateway";

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

interface CreateAppVibeAppArgs {
  input: Parameters<typeof createAppVibeApp>[3];
}

interface SendAppVibeAppPromptArgs {
  input: Parameters<typeof sendAppVibeAppPrompt>[3];
}

interface AppVibeAppTargetArgs {
  input: Parameters<typeof publishAppVibeApp>[3];
}

function parseAppId(value: string): AppId {
  return parsePlatformId<AppId>(value, "App ID");
}

export const appGraphQLModule = {
  ...appGraphQLSpec,
  authenticatedMutationResolvers: {
    createApp: async (_parent, args: CreateAppArgs, context) =>
      createApp(context.bindings.DB, context.viewer, args.input),
    createAppVibeApp: async (_parent, args: CreateAppVibeAppArgs, context) =>
      createAppVibeApp(
        context.bindings.DB,
        createVibesdkGateway(context.bindings),
        context.viewer,
        args.input,
      ),
    createAppVibeAppCloneUrl: async (_parent, args: AppVibeAppTargetArgs, context) =>
      createAppVibeAppCloneUrl(
        context.bindings.DB,
        createVibesdkGateway(context.bindings),
        context.viewer,
        args.input,
      ),
    deleteAppVibeApp: async (_parent, args: AppVibeAppTargetArgs, context) =>
      deleteAppVibeApp(
        context.bindings.DB,
        createVibesdkGateway(context.bindings),
        context.viewer,
        args.input,
      ),
    publishAppVibeApp: async (_parent, args: AppVibeAppTargetArgs, context) =>
      publishAppVibeApp(
        context.bindings.DB,
        createVibesdkGateway(context.bindings),
        context.viewer,
        args.input,
      ),
    refreshAppVibeAppPreview: async (_parent, args: AppVibeAppTargetArgs, context) =>
      refreshAppVibeAppPreview(
        context.bindings.DB,
        createVibesdkGateway(context.bindings),
        context.viewer,
        args.input,
      ),
    renameApp: async (_parent, args: RenameAppArgs, context) =>
      renameApp(context.bindings.DB, context.viewer, args.input),
    sendAppVibeAppPrompt: async (_parent, args: SendAppVibeAppPromptArgs, context) =>
      sendAppVibeAppPrompt(
        context.bindings.DB,
        createVibesdkGateway(context.bindings),
        context.viewer,
        args.input,
      ),
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
        createVibesdkGateway(context.bindings),
        context.viewer,
        parseAppId(args.appId),
      ),
    controlPlaneOverview: async (_parent, args: ControlPlaneOverviewArgs, context) =>
      getControlPlaneOverview(context.bindings.DB, context.viewer, {
        ...(args.agentLimit === undefined ? {} : { agentLimit: args.agentLimit }),
        ...(args.appLimit === undefined ? {} : { appLimit: args.appLimit }),
        ...(args.credentialLimit === undefined ? {} : { credentialLimit: args.credentialLimit }),
      }),
  },
} satisfies GraphQLModule;
