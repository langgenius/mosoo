import { parsePlatformId } from "@mosoo/id";
import type { AgentId, AppId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { channelGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  createDiscordAgentChannelBinding,
  createLarkAgentChannelBinding,
  createSlackAgentChannelBinding,
  createTelegramAgentChannelBinding,
  deleteAgentChannelBinding,
  listAgentChannelBindings,
  pollLarkAgentChannelRegistration,
  pollWeChatAgentChannelPairing,
  startLarkAgentChannelRegistration,
  startWeChatAgentChannelPairing,
} from "../application/agent-channel-binding.service";

interface AgentChannelBindingListArgs {
  agentId: string;
  appId: string;
}

interface CreateSlackAgentChannelBindingArgs {
  input: Parameters<typeof createSlackAgentChannelBinding>[2];
}

interface CreateLarkAgentChannelBindingArgs {
  input: Parameters<typeof createLarkAgentChannelBinding>[2];
}

interface CreateTelegramAgentChannelBindingArgs {
  input: Parameters<typeof createTelegramAgentChannelBinding>[2];
}

interface CreateDiscordAgentChannelBindingArgs {
  input: Parameters<typeof createDiscordAgentChannelBinding>[2];
}

interface StartLarkAgentChannelRegistrationArgs {
  input: Parameters<typeof startLarkAgentChannelRegistration>[2];
}

interface PollLarkAgentChannelRegistrationArgs {
  input: Parameters<typeof pollLarkAgentChannelRegistration>[2];
}

interface StartWeChatAgentChannelPairingArgs {
  input: Parameters<typeof startWeChatAgentChannelPairing>[2];
}

interface PollWeChatAgentChannelPairingArgs {
  input: Parameters<typeof pollWeChatAgentChannelPairing>[2];
}

interface DeleteAgentChannelBindingArgs {
  input: Parameters<typeof deleteAgentChannelBinding>[2];
}

export const channelGraphQLModule = {
  ...channelGraphQLSpec,
  authenticatedMutationResolvers: {
    createDiscordAgentChannelBinding: async (
      _parent,
      args: CreateDiscordAgentChannelBindingArgs,
      context,
    ) => createDiscordAgentChannelBinding(context.bindings, context.viewer, args.input),
    createLarkAgentChannelBinding: async (
      _parent,
      args: CreateLarkAgentChannelBindingArgs,
      context,
    ) => createLarkAgentChannelBinding(context.bindings, context.viewer, args.input),
    createSlackAgentChannelBinding: async (
      _parent,
      args: CreateSlackAgentChannelBindingArgs,
      context,
    ) => createSlackAgentChannelBinding(context.bindings, context.viewer, args.input),
    createTelegramAgentChannelBinding: async (
      _parent,
      args: CreateTelegramAgentChannelBindingArgs,
      context,
    ) => createTelegramAgentChannelBinding(context.bindings, context.viewer, args.input),
    pollLarkAgentChannelRegistration: async (
      _parent,
      args: PollLarkAgentChannelRegistrationArgs,
      context,
    ) => pollLarkAgentChannelRegistration(context.bindings, context.viewer, args.input),
    pollWeChatAgentChannelPairing: async (
      _parent,
      args: PollWeChatAgentChannelPairingArgs,
      context,
    ) => pollWeChatAgentChannelPairing(context.bindings, context.viewer, args.input),
    startLarkAgentChannelRegistration: async (
      _parent,
      args: StartLarkAgentChannelRegistrationArgs,
      context,
    ) => startLarkAgentChannelRegistration(context.bindings, context.viewer, args.input),
    startWeChatAgentChannelPairing: async (
      _parent,
      args: StartWeChatAgentChannelPairingArgs,
      context,
    ) => startWeChatAgentChannelPairing(context.bindings, context.viewer, args.input),
    deleteAgentChannelBinding: async (_parent, args: DeleteAgentChannelBindingArgs, context) => {
      await deleteAgentChannelBinding(context.bindings, context.viewer, args.input);
      return { ok: true } as const;
    },
  },
  authenticatedQueryResolvers: {
    agentChannelBindingList: async (_parent, args: AgentChannelBindingListArgs, context) => {
      const agentId = parsePlatformId<AgentId>(args.agentId, "agent ID");
      const appId = parsePlatformId<AppId>(args.appId, "app ID");
      return listAgentChannelBindings(context.bindings.DB, context.viewer, {
        agentId,
        appId,
      });
    },
  },
} satisfies GraphQLModule;
