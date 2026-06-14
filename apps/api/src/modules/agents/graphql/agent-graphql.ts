import { parsePlatformId } from "@mosoo/id";
import type { AgentId, AppId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { agentGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  recreateSandbox,
  resetAgentState,
  restartDriver,
} from "../../runtime/application/runtime-state-operations.service";
import {
  createAgent,
  deleteAgent,
  publishAgent,
  unpublishAgent,
  updateAgentConfig,
} from "../application/agent-command.service";
import { createAgentFork } from "../application/agent-fork.service";
import { exportAgentManifest } from "../application/agent-manifest.service";
import { exportAgentPackage } from "../application/agent-package-export.service";
import { importAgentPackage } from "../application/agent-package-import.service";
import {
  getAgent,
  getAgentEditorState,
  listVisibleAgents,
} from "../application/agent-query.service";

interface AppIdArgs {
  appId: string;
}

interface AppAgentIdArgs {
  agentId: string;
  appId: string;
}

interface CreateAgentArgs {
  input: Parameters<typeof createAgent>[2];
}

interface CreateAgentForkArgs {
  input: Parameters<typeof createAgentFork>[2];
}

interface DeleteAgentArgs {
  input: Parameters<typeof deleteAgent>[2];
}

interface PublishAgentArgs {
  input: Parameters<typeof publishAgent>[2];
}

interface RuntimeStateOperationArgs {
  input: Parameters<typeof restartDriver>[2];
}

interface UpdateAgentConfigArgs {
  input: Parameters<typeof updateAgentConfig>[2];
}

interface ImportAgentPackageArgs {
  input: Parameters<typeof importAgentPackage>[2];
}

function parseAgentId(value: string): AgentId {
  return parsePlatformId<AgentId>(value, "Agent ID");
}

function parseAppId(value: string): AppId {
  return parsePlatformId<AppId>(value, "App ID");
}

export const agentGraphQLModule = {
  ...agentGraphQLSpec,
  authenticatedMutationResolvers: {
    createAgent: async (_parent, args: CreateAgentArgs, context) =>
      createAgent(context.bindings, context.viewer, args.input),
    createAgentFork: async (_parent, args: CreateAgentForkArgs, context) =>
      createAgentFork(context.bindings, context.viewer, args.input),
    deleteAgent: async (_parent, args: DeleteAgentArgs, context) => {
      await deleteAgent(context.bindings.DB, context.viewer, args.input);
      return { ok: true } as const;
    },
    importAgentPackage: async (_parent, args: ImportAgentPackageArgs, context) =>
      importAgentPackage(context.bindings, context.viewer, args.input),
    publishAgent: async (_parent, args: PublishAgentArgs, context) =>
      publishAgent(context.bindings, context.viewer, args.input),
    recreateSandbox: async (_parent, args: RuntimeStateOperationArgs, context) =>
      recreateSandbox(context.bindings, context.viewer, args.input),
    resetAgentState: async (_parent, args: RuntimeStateOperationArgs, context) =>
      resetAgentState(context.bindings, context.viewer, args.input),
    restartDriver: async (_parent, args: RuntimeStateOperationArgs, context) =>
      restartDriver(context.bindings, context.viewer, args.input),
    unpublishAgent: async (_parent, args: AppAgentIdArgs, context) =>
      unpublishAgent(context.bindings.DB, context.viewer, {
        agentId: parseAgentId(args.agentId),
        appId: parseAppId(args.appId),
      }),
    updateAgentConfig: async (_parent, args: UpdateAgentConfigArgs, context) =>
      updateAgentConfig(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    accessibleAgentList: async (_parent, args: AppIdArgs, context) =>
      listVisibleAgents(context.bindings.DB, context.viewer, parseAppId(args.appId)),
    agent: async (_parent, args: AppAgentIdArgs, context) =>
      getAgent(context.bindings.DB, context.viewer, {
        agentId: parseAgentId(args.agentId),
        appId: parseAppId(args.appId),
      }),
    agentEditorState: async (_parent, args: AppAgentIdArgs, context) =>
      getAgentEditorState(context.bindings.DB, context.viewer, {
        agentId: parseAgentId(args.agentId),
        appId: parseAppId(args.appId),
      }),
    agentManifest: async (_parent, args: AppAgentIdArgs, context) =>
      exportAgentManifest(context.bindings.DB, context.viewer, {
        agentId: parseAgentId(args.agentId),
        appId: parseAppId(args.appId),
      }),
    exportAgentPackage: async (_parent, args: AppAgentIdArgs, context) =>
      exportAgentPackage(context.bindings, context.viewer, {
        agentId: parseAgentId(args.agentId),
        appId: parseAppId(args.appId),
      }),
  },
} satisfies GraphQLModule;
