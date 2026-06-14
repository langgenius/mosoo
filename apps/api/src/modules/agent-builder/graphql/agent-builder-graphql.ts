import { parsePlatformId } from "@mosoo/id";
import type { AppId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { agentBuilderGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import type { ExecuteAgentBuilderControlPlaneActionInput } from "../application/agent-builder-control-plane-action.service";
import { executeAgentBuilderControlPlaneAction } from "../application/agent-builder-control-plane-action.service";
import { parseAgentId } from "../application/agent-builder-ids";
import {
  ensureAgentBuilderThread,
  listAgentBuilderMessages,
} from "../application/agent-builder-thread.service";

interface AgentIdArgs {
  agentId: string;
}

interface AgentBuilderMessagesArgs extends AgentIdArgs {
  beforeSeq?: number | null;
  limit?: number | null;
}

interface ExecuteAgentBuilderControlPlaneActionArgs {
  input: Omit<ExecuteAgentBuilderControlPlaneActionInput, "agentId"> & {
    readonly agentId: string;
    readonly appId: string;
  };
}

export const agentBuilderGraphQLModule = {
  ...agentBuilderGraphQLSpec,
  authenticatedMutationResolvers: {
    ensureAgentBuilderThread: async (_parent, args: AgentIdArgs, context) =>
      ensureAgentBuilderThread(
        context.bindings.DB,
        context.viewer,
        parseAgentId(args.agentId, "agentId"),
      ),
    executeAgentBuilderControlPlaneAction: async (
      _parent,
      args: ExecuteAgentBuilderControlPlaneActionArgs,
      context,
    ) =>
      executeAgentBuilderControlPlaneAction(context.bindings, context.viewer, {
        ...args.input,
        agentId: parseAgentId(args.input.agentId, "input.agentId"),
        appId: parsePlatformId<AppId>(args.input.appId, "input.appId"),
      }),
  },
  authenticatedQueryResolvers: {
    agentBuilderMessages: async (_parent, args: AgentBuilderMessagesArgs, context) =>
      listAgentBuilderMessages(context.bindings.DB, context.viewer, {
        ...args,
        agentId: parseAgentId(args.agentId, "agentId"),
      }),
  },
} satisfies GraphQLModule;
