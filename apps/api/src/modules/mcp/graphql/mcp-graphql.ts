import type { McpOAuthFlowId, McpServerId, ProjectId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { getMcpOAuthFlowState, startMcpOAuth } from "../application/mcp-oauth-flow.service";
import { getMcpRegistry } from "../application/mcp-registry.service";
import {
  connectMcpBearer,
  revokeMcpCredential,
} from "../application/mcp-server-credential.service";
import {
  createProjectMcpServer,
  deleteMcpServer,
  setMcpServerEnabled,
  updateProjectMcpServer,
} from "../application/mcp-server-management.service";

interface ProjectIdArgs {
  projectId: ProjectId;
}

interface FlowIdArgs {
  flowId: McpOAuthFlowId;
}

interface ServerIdArgs {
  projectId: ProjectId;
  serverId: McpServerId;
}

interface SetMcpServerEnabledArgs extends ServerIdArgs {
  enabled: boolean;
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
  authenticatedMutationResolvers: {
    connectMcpBearer: async (_parent, args: ConnectMcpBearerArgs, context) =>
      connectMcpBearer(context.bindings, context.viewer, args.input),
    createProjectMcpServer: async (_parent, args: CreateProjectMcpServerArgs, context) =>
      createProjectMcpServer(context.bindings, context.viewer, args.input),
    deleteMcpServer: async (_parent, args: ServerIdArgs, context) => {
      await deleteMcpServer(context.bindings.DB, context.viewer, args.projectId, args.serverId);
      return { ok: true } as const;
    },
    revokeMcpCredential: async (_parent, args: ServerIdArgs, context) =>
      revokeMcpCredential(context.bindings.DB, context.viewer, args.projectId, args.serverId),
    setMcpServerEnabled: async (_parent, args: SetMcpServerEnabledArgs, context) =>
      setMcpServerEnabled(
        context.bindings.DB,
        context.viewer,
        args.projectId,
        args.serverId,
        args.enabled,
      ),
    startMcpOAuth: async (_parent, args: StartMcpOAuthArgs, context) =>
      startMcpOAuth(context.bindings, context.request.url, context.viewer, args.input),
    updateProjectMcpServer: async (_parent, args: UpdateProjectMcpServerArgs, context) =>
      updateProjectMcpServer(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    mcpOAuthFlowStatus: async (_parent, args: FlowIdArgs, context) =>
      getMcpOAuthFlowState(context.bindings, context.viewer, args.flowId),
    mcpRegistry: async (_parent, args: ProjectIdArgs, context) =>
      getMcpRegistry(context.bindings.DB, context.viewer, args.projectId),
  },
} satisfies GraphQLModule;
