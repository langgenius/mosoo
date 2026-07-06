import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { mcpGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { getMcpOAuthFlowState, startMcpOAuth } from "../application/mcp-oauth.service";
import { readMcpOAuthFlowId, readMcpServerId, readAppId } from "../application/mcp-platform-ids";
import {
  connectMcpBearer,
  createAppMcpServer,
  deleteMcpServer,
  getMcpRegistry,
  revokeMcpCredential,
  setMcpServerEnabled,
  updateAppMcpServer,
} from "../application/mcp-server.service";

interface AppIdArgs {
  appId: string;
}

interface FlowIdArgs {
  flowId: string;
}

interface ServerIdArgs {
  appId: string;
  serverId: string;
}

interface SetMcpServerEnabledArgs {
  enabled: boolean;
  appId: string;
  serverId: string;
}

interface CreateAppMcpServerArgs {
  input: Parameters<typeof createAppMcpServer>[2];
}

interface ConnectMcpBearerArgs {
  input: Parameters<typeof connectMcpBearer>[2];
}

interface StartMcpOAuthArgs {
  input: Parameters<typeof startMcpOAuth>[3];
}

interface UpdateAppMcpServerArgs {
  input: Parameters<typeof updateAppMcpServer>[2];
}

export const mcpGraphQLModule = {
  ...mcpGraphQLSpec,
  authenticatedMutationResolvers: {
    connectMcpBearer: async (_parent, args: ConnectMcpBearerArgs, context) =>
      connectMcpBearer(context.bindings, context.viewer, {
        ...args.input,
        appId: readAppId(args.input.appId),
        serverId: readMcpServerId(args.input.serverId),
      }),
    createAppMcpServer: async (_parent, args: CreateAppMcpServerArgs, context) =>
      createAppMcpServer(context.bindings, context.viewer, {
        ...args.input,
        appId: readAppId(args.input.appId),
      }),
    deleteMcpServer: async (_parent, args: ServerIdArgs, context) => {
      await deleteMcpServer(
        context.bindings.DB,
        context.viewer,
        readAppId(args.appId),
        readMcpServerId(args.serverId),
      );
      return { ok: true } as const;
    },
    revokeMcpCredential: async (_parent, args: ServerIdArgs, context) =>
      revokeMcpCredential(
        context.bindings.DB,
        context.viewer,
        readAppId(args.appId),
        readMcpServerId(args.serverId),
      ),
    setMcpServerEnabled: async (_parent, args: SetMcpServerEnabledArgs, context) =>
      setMcpServerEnabled(
        context.bindings.DB,
        context.viewer,
        readAppId(args.appId),
        readMcpServerId(args.serverId),
        args.enabled,
      ),
    startMcpOAuth: async (_parent, args: StartMcpOAuthArgs, context) =>
      startMcpOAuth(context.bindings, context.request.url, context.viewer, {
        ...args.input,
        appId: readAppId(args.input.appId),
        serverId: readMcpServerId(args.input.serverId),
      }),
    updateAppMcpServer: async (_parent, args: UpdateAppMcpServerArgs, context) =>
      updateAppMcpServer(context.bindings.DB, context.viewer, {
        ...args.input,
        appId: readAppId(args.input.appId),
        serverId: readMcpServerId(args.input.serverId),
      }),
  },
  authenticatedQueryResolvers: {
    mcpOAuthFlowStatus: async (_parent, args: FlowIdArgs, context) =>
      getMcpOAuthFlowState(context.bindings, context.viewer, readMcpOAuthFlowId(args.flowId)),
    mcpRegistry: async (_parent, args: AppIdArgs, context) =>
      getMcpRegistry(context.bindings.DB, context.viewer, readAppId(args.appId)),
  },
} satisfies GraphQLModule;
