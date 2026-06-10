import { parsePlatformId } from "@mosoo/id";
import type { AgentId, OrganizationId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { agentGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  recreateSandbox,
  resetAgentState,
  restartDriver,
} from "../../runtime/application/runtime-state-operations.service";
import {
  addAgentCollaborator,
  listAgentCollaborators,
  removeAgentCollaborator,
  updateAgentCollaborator,
} from "../application/agent-collaborator.service";
import {
  createAgent,
  deleteAgent,
  publishAgent,
  unpublishAgent,
  updateAgentConfig,
  updateAgentPackageSharing,
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

interface OrganizationIdArgs {
  organizationId: string;
}

interface AgentIdArgs {
  agentId: string;
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

interface AddAgentCollaboratorArgs {
  input: Parameters<typeof addAgentCollaborator>[2];
}

interface RemoveAgentCollaboratorArgs {
  input: Parameters<typeof removeAgentCollaborator>[2];
}

interface UpdateAgentCollaboratorArgs {
  input: Parameters<typeof updateAgentCollaborator>[2];
}

interface UpdateAgentConfigArgs {
  input: Parameters<typeof updateAgentConfig>[2];
}

interface UpdateAgentPackageSharingArgs {
  input: Parameters<typeof updateAgentPackageSharing>[2];
}

interface ImportAgentPackageArgs {
  input: Parameters<typeof importAgentPackage>[2];
}

function parseAgentId(value: string): AgentId {
  return parsePlatformId<AgentId>(value, "Agent ID");
}

function parseOrganizationId(value: string): OrganizationId {
  return parsePlatformId<OrganizationId>(value, "Organization ID");
}

export const agentGraphQLModule = {
  ...agentGraphQLSpec,
  authenticatedMutationResolvers: {
    addAgentCollaborator: async (_parent, args: AddAgentCollaboratorArgs, context) => {
      await addAgentCollaborator(context.bindings.DB, context.viewer, args.input);
      return { ok: true } as const;
    },
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
    removeAgentCollaborator: async (_parent, args: RemoveAgentCollaboratorArgs, context) => {
      await removeAgentCollaborator(context.bindings.DB, context.viewer, args.input);
      return { ok: true } as const;
    },
    resetAgentState: async (_parent, args: RuntimeStateOperationArgs, context) =>
      resetAgentState(context.bindings, context.viewer, args.input),
    restartDriver: async (_parent, args: RuntimeStateOperationArgs, context) =>
      restartDriver(context.bindings, context.viewer, args.input),
    unpublishAgent: async (_parent, args: AgentIdArgs, context) =>
      unpublishAgent(context.bindings.DB, context.viewer, parseAgentId(args.agentId)),
    updateAgentCollaborator: async (_parent, args: UpdateAgentCollaboratorArgs, context) => {
      await updateAgentCollaborator(context.bindings.DB, context.viewer, args.input);
      return { ok: true } as const;
    },
    updateAgentConfig: async (_parent, args: UpdateAgentConfigArgs, context) =>
      updateAgentConfig(context.bindings.DB, context.viewer, args.input),
    updateAgentPackageSharing: async (_parent, args: UpdateAgentPackageSharingArgs, context) =>
      updateAgentPackageSharing(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    accessibleAgentList: async (_parent, args: OrganizationIdArgs, context) =>
      listVisibleAgents(
        context.bindings.DB,
        context.viewer,
        parseOrganizationId(args.organizationId),
      ),
    agent: async (_parent, args: AgentIdArgs, context) =>
      getAgent(context.bindings.DB, context.viewer, parseAgentId(args.agentId)),
    agentCollaboratorList: async (_parent, args: AgentIdArgs, context) =>
      listAgentCollaborators(context.bindings.DB, context.viewer, parseAgentId(args.agentId)),
    agentEditorState: async (_parent, args: AgentIdArgs, context) =>
      getAgentEditorState(context.bindings.DB, context.viewer, parseAgentId(args.agentId)),
    agentManifest: async (_parent, args: AgentIdArgs, context) =>
      exportAgentManifest(context.bindings.DB, context.viewer, parseAgentId(args.agentId)),
    exportAgentPackage: async (_parent, args: AgentIdArgs, context) =>
      exportAgentPackage(context.bindings, context.viewer, parseAgentId(args.agentId)),
  },
} satisfies GraphQLModule;
