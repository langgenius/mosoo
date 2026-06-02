import { graphql } from "@/gql";

const AGENT_CHANNEL_BINDING_FIELDS = graphql(/* GraphQL */ `
  fragment AgentChannelBindingFields on AgentChannelBinding {
    activityLastTriggeredAt
    activitySessionCount7d
    agentId
    createdAt
    displayMetadata
    externalBotId
    externalTenantId
    id
    lastErrorCode
    provider
    status
    updatedAt
  }
`);

export const AGENT_CHANNEL_BINDINGS_QUERY = graphql(/* GraphQL */ `
  query AgentChannelBindings($agentId: ULID!) {
    agentChannelBindingList(agentId: $agentId) {
      ...AgentChannelBindingFields
    }
  }
`);

export const CREATE_SLACK_AGENT_CHANNEL_BINDING_MUTATION = graphql(/* GraphQL */ `
  mutation CreateSlackAgentChannelBinding($input: CreateSlackAgentChannelBindingInput!) {
    createSlackAgentChannelBinding(input: $input) {
      ...AgentChannelBindingFields
    }
  }
`);

export const CREATE_LARK_AGENT_CHANNEL_BINDING_MUTATION = graphql(/* GraphQL */ `
  mutation CreateLarkAgentChannelBinding($input: CreateLarkAgentChannelBindingInput!) {
    createLarkAgentChannelBinding(input: $input) {
      ...AgentChannelBindingFields
    }
  }
`);

const LARK_AGENT_CHANNEL_REGISTRATION_FIELDS = graphql(/* GraphQL */ `
  fragment LarkAgentChannelRegistrationFields on LarkAgentChannelRegistration {
    appId
    appSecret
    deviceCode
    domain
    expireIn
    interval
    lastErrorCode
    openId
    qrUrl
    status
    userCode
  }
`);

export const START_LARK_AGENT_CHANNEL_REGISTRATION_MUTATION = graphql(/* GraphQL */ `
  mutation StartLarkAgentChannelRegistration($input: StartLarkAgentChannelRegistrationInput!) {
    startLarkAgentChannelRegistration(input: $input) {
      ...LarkAgentChannelRegistrationFields
    }
  }
`);

export const POLL_LARK_AGENT_CHANNEL_REGISTRATION_MUTATION = graphql(/* GraphQL */ `
  mutation PollLarkAgentChannelRegistration($input: PollLarkAgentChannelRegistrationInput!) {
    pollLarkAgentChannelRegistration(input: $input) {
      ...LarkAgentChannelRegistrationFields
    }
  }
`);

export const CREATE_TELEGRAM_AGENT_CHANNEL_BINDING_MUTATION = graphql(/* GraphQL */ `
  mutation CreateTelegramAgentChannelBinding($input: CreateTelegramAgentChannelBindingInput!) {
    createTelegramAgentChannelBinding(input: $input) {
      ...AgentChannelBindingFields
    }
  }
`);

export const CREATE_DISCORD_AGENT_CHANNEL_BINDING_MUTATION = graphql(/* GraphQL */ `
  mutation CreateDiscordAgentChannelBinding($input: CreateDiscordAgentChannelBindingInput!) {
    createDiscordAgentChannelBinding(input: $input) {
      ...AgentChannelBindingFields
    }
  }
`);

const WECHAT_AGENT_CHANNEL_PAIRING_FIELDS = graphql(/* GraphQL */ `
  fragment WeChatAgentChannelPairingFields on WeChatAgentChannelPairing {
    binding {
      ...AgentChannelBindingFields
    }
    lastErrorCode
    qrCodeImageSrc
    qrToken
    status
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([
  AGENT_CHANNEL_BINDING_FIELDS,
  LARK_AGENT_CHANNEL_REGISTRATION_FIELDS,
  WECHAT_AGENT_CHANNEL_PAIRING_FIELDS,
]);

export const START_WECHAT_AGENT_CHANNEL_PAIRING_MUTATION = graphql(/* GraphQL */ `
  mutation StartWeChatAgentChannelPairing($input: StartWeChatAgentChannelPairingInput!) {
    startWeChatAgentChannelPairing(input: $input) {
      ...WeChatAgentChannelPairingFields
    }
  }
`);

export const POLL_WECHAT_AGENT_CHANNEL_PAIRING_MUTATION = graphql(/* GraphQL */ `
  mutation PollWeChatAgentChannelPairing($input: PollWeChatAgentChannelPairingInput!) {
    pollWeChatAgentChannelPairing(input: $input) {
      ...WeChatAgentChannelPairingFields
    }
  }
`);

export const DELETE_AGENT_CHANNEL_BINDING_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteAgentChannelBinding($input: DeleteAgentChannelBindingInput!) {
    deleteAgentChannelBinding(input: $input) {
      ok
    }
  }
`);
