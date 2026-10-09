import type { AgentId, ProjectId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
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

interface ProjectIdArgs {
  projectId: ProjectId;
}

interface ProjectAgentIdArgs {
  agentId: AgentId;
  projectId: ProjectId;
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

interface UpdateAgentConfigArgs {
  input: Parameters<typeof updateAgentConfig>[2];
}

interface ImportAgentPackageArgs {
  input: Parameters<typeof importAgentPackage>[2];
}

export const agentGraphQLModule = {
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
      publishAgent(context.bindings.DB, context.viewer, args.input),
    unpublishAgent: async (_parent, args: ProjectAgentIdArgs, context) =>
      unpublishAgent(context.bindings.DB, context.viewer, args),
    updateAgentConfig: async (_parent, args: UpdateAgentConfigArgs, context) =>
      updateAgentConfig(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    accessibleAgentList: async (_parent, args: ProjectIdArgs, context) =>
      listVisibleAgents(context.bindings.DB, context.viewer, args.projectId),
    agent: async (_parent, args: ProjectAgentIdArgs, context) =>
      getAgent(context.bindings.DB, context.viewer, args),
    agentEditorState: async (_parent, args: ProjectAgentIdArgs, context) =>
      getAgentEditorState(context.bindings.DB, context.viewer, args),
    agentManifest: async (_parent, args: ProjectAgentIdArgs, context) =>
      exportAgentManifest(context.bindings.DB, context.viewer, args),
    exportAgentPackage: async (_parent, args: ProjectAgentIdArgs, context) =>
      exportAgentPackage(context.bindings, context.viewer, args),
  },
} satisfies GraphQLModule;
