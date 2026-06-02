import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { agentBuilderGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
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

export const agentBuilderGraphQLModule = {
  ...agentBuilderGraphQLSpec,
  authenticatedMutationResolvers: {
    ensureAgentBuilderThread: async (_parent, args: AgentIdArgs, context) =>
      ensureAgentBuilderThread(
        context.bindings.DB,
        context.viewer,
        parseAgentId(args.agentId, "agentId"),
      ),
  },
  authenticatedQueryResolvers: {
    agentBuilderMessages: async (_parent, args: AgentBuilderMessagesArgs, context) =>
      listAgentBuilderMessages(context.bindings.DB, context.viewer, {
        ...args,
        agentId: parseAgentId(args.agentId, "agentId"),
      }),
  },
} satisfies GraphQLModule;
