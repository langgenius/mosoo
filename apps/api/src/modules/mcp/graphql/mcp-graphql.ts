import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { mcpGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { getMcpOAuthFlowState, startMcpOAuth } from "../application/mcp-oauth.service";
import {
  readMcpOAuthFlowId,
  readMcpServerId,
  readProjectId,
} from "../application/mcp-platform-ids";
import {
  connectMcpBearer,
  createProjectMcpServer,
  deleteMcpServer,
  getMcpRegistry,
  revokeMcpCredential,
  setMcpServerEnabled,
  updateProjectMcpServer,
} from "../application/mcp-server.service";

interface ProjectIdArgs {
  projectId: string;
}

interface FlowIdArgs {
  flowId: string;
}

interface ServerIdArgs {
  projectId: string;
  serverId: string;
}

interface SetMcpServerEnabledArgs {
  enabled: boolean;
  projectId: string;
  serverId: string;
}

interface CreateProjectMcpServerArgs {
  input: Parameters<typeof createProjectMcpServer>[2];
}

interface ConnectMcpBearerArgs {
  input: Parameters<typeof connectMcpBearer>[2];
}

interface StartMcpOAuthArgs {
  input: Parameters<typeof startMcpOAuth>[3];
}

interface UpdateProjectMcpServerArgs {
  input: Parameters<typeof updateProjectMcpServer>[2];
}

export const mcpGraphQLModule = {
  ...mcpGraphQLSpec,
  authenticatedMutationResolvers: {
    connectMcpBearer: async (_parent, args: ConnectMcpBearerArgs, context) =>
      connectMcpBearer(context.bindings, context.viewer, {
        ...args.input,
        projectId: readProjectId(args.input.projectId),
        serverId: readMcpServerId(args.input.serverId),
      }),
    createProjectMcpServer: async (_parent, args: CreateProjectMcpServerArgs, context) =>
      createProjectMcpServer(context.bindings, context.viewer, {
        ...args.input,
        projectId: readProjectId(args.input.projectId),
      }),
    deleteMcpServer: async (_parent, args: ServerIdArgs, context) => {
      await deleteMcpServer(
        context.bindings.DB,
        context.viewer,
        readProjectId(args.projectId),
        readMcpServerId(args.serverId),
      );
      return { ok: true } as const;
    },
    revokeMcpCredential: async (_parent, args: ServerIdArgs, context) =>
      revokeMcpCredential(
        context.bindings.DB,
        context.viewer,
        readProjectId(args.projectId),
        readMcpServerId(args.serverId),
      ),
    setMcpServerEnabled: async (_parent, args: SetMcpServerEnabledArgs, context) =>
      setMcpServerEnabled(
        context.bindings.DB,
        context.viewer,
        readProjectId(args.projectId),
        readMcpServerId(args.serverId),
        args.enabled,
      ),
    startMcpOAuth: async (_parent, args: StartMcpOAuthArgs, context) =>
      startMcpOAuth(context.bindings, context.request.url, context.viewer, {
        ...args.input,
        projectId: readProjectId(args.input.projectId),
        serverId: readMcpServerId(args.input.serverId),
      }),
    updateProjectMcpServer: async (_parent, args: UpdateProjectMcpServerArgs, context) =>
      updateProjectMcpServer(context.bindings.DB, context.viewer, {
        ...args.input,
        projectId: readProjectId(args.input.projectId),
        serverId: readMcpServerId(args.input.serverId),
      }),
  },
  authenticatedQueryResolvers: {
    mcpOAuthFlowStatus: async (_parent, args: FlowIdArgs, context) =>
      getMcpOAuthFlowState(context.bindings, context.viewer, readMcpOAuthFlowId(args.flowId)),
    mcpRegistry: async (_parent, args: ProjectIdArgs, context) =>
      getMcpRegistry(context.bindings.DB, context.viewer, readProjectId(args.projectId)),
  },
} satisfies GraphQLModule;
