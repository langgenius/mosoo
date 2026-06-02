import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { mcpGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { getMcpOAuthFlowState, startMcpOAuth } from "../application/mcp-oauth.service";
import {
  readMcpOAuthFlowId,
  readMcpServerId,
  readOrganizationId,
} from "../application/mcp-platform-ids";
import {
  clearOrganizationSharedCredential,
  connectMcpBearer,
  createOrganizationMcpServer,
  createPersonalMcpServer,
  deleteMcpServer,
  getMcpRegistry,
  revokeMcpUserCredential,
  setMcpServerEnabled,
  setOrganizationSharedBearer,
} from "../application/mcp-server.service";

interface OrganizationIdArgs {
  organizationId: string;
}

interface FlowIdArgs {
  flowId: string;
}

interface ServerIdArgs {
  serverId: string;
}

interface SetMcpServerEnabledArgs {
  enabled: boolean;
  serverId: string;
}

interface CreatePersonalMcpServerArgs {
  input: Parameters<typeof createPersonalMcpServer>[2];
}

interface CreateOrganizationMcpServerArgs {
  input: Parameters<typeof createOrganizationMcpServer>[2];
}

interface ConnectMcpBearerArgs {
  input: Parameters<typeof connectMcpBearer>[2];
}

interface SetOrganizationSharedMcpBearerArgs {
  input: Parameters<typeof setOrganizationSharedBearer>[2];
}

interface StartMcpOAuthArgs {
  input: Parameters<typeof startMcpOAuth>[3];
}

export const mcpGraphQLModule = {
  ...mcpGraphQLSpec,
  authenticatedMutationResolvers: {
    clearOrganizationSharedCredential: async (_parent, args: ServerIdArgs, context) =>
      clearOrganizationSharedCredential(
        context.bindings.DB,
        context.viewer,
        readMcpServerId(args.serverId),
      ),
    connectMcpBearer: async (_parent, args: ConnectMcpBearerArgs, context) =>
      connectMcpBearer(context.bindings, context.viewer, {
        ...args.input,
        serverId: readMcpServerId(args.input.serverId),
      }),
    createOrganizationMcpServer: async (_parent, args: CreateOrganizationMcpServerArgs, context) =>
      createOrganizationMcpServer(context.bindings, context.viewer, {
        ...args.input,
        organizationId: readOrganizationId(args.input.organizationId),
      }),
    createPersonalMcpServer: async (_parent, args: CreatePersonalMcpServerArgs, context) =>
      createPersonalMcpServer(context.bindings, context.viewer, {
        ...args.input,
        organizationId: readOrganizationId(args.input.organizationId),
      }),
    deleteMcpServer: async (_parent, args: ServerIdArgs, context) => {
      await deleteMcpServer(context.bindings.DB, context.viewer, readMcpServerId(args.serverId));
      return { ok: true } as const;
    },
    revokeMcpUserCredential: async (_parent, args: ServerIdArgs, context) =>
      revokeMcpUserCredential(context.bindings.DB, context.viewer, readMcpServerId(args.serverId)),
    setMcpServerEnabled: async (_parent, args: SetMcpServerEnabledArgs, context) =>
      setMcpServerEnabled(
        context.bindings.DB,
        context.viewer,
        readMcpServerId(args.serverId),
        args.enabled,
      ),
    setOrganizationSharedBearer: async (
      _parent,
      args: SetOrganizationSharedMcpBearerArgs,
      context,
    ) =>
      setOrganizationSharedBearer(context.bindings, context.viewer, {
        ...args.input,
        serverId: readMcpServerId(args.input.serverId),
      }),
    startMcpOAuth: async (_parent, args: StartMcpOAuthArgs, context) =>
      startMcpOAuth(context.bindings, context.request.url, context.viewer, {
        ...args.input,
        serverId: readMcpServerId(args.input.serverId),
      }),
  },
  authenticatedQueryResolvers: {
    mcpOAuthFlowStatus: async (_parent, args: FlowIdArgs, context) =>
      getMcpOAuthFlowState(context.bindings, context.viewer, readMcpOAuthFlowId(args.flowId)),
    mcpRegistry: async (_parent, args: OrganizationIdArgs, context) =>
      getMcpRegistry(context.bindings.DB, context.viewer, readOrganizationId(args.organizationId)),
  },
} satisfies GraphQLModule;
