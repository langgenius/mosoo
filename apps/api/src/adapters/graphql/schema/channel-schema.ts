import { AGENT_CHANNEL_BINDING_PROVIDERS } from "@mosoo/contracts/channel";

const channelProviderEnumValues = AGENT_CHANNEL_BINDING_PROVIDERS.map(
  (provider) => `    ${provider}`,
).join("\n");

export const channelSchema = /* GraphQL */ `
  enum ChannelProvider {
${channelProviderEnumValues}
  }

  enum AgentChannelBindingStatus {
    active
    error
  }

  type AgentChannelBinding {
    activityLastTriggeredAt: String
    activitySessionCount7d: Int!
    agentId: ULID!
    createdAt: String!
    displayMetadata: PrimitiveRecord!
    externalBotId: String!
    externalTenantId: String!
    id: ULID!
    lastErrorCode: String
    appId: ULID!
    provider: ChannelProvider!
    status: AgentChannelBindingStatus!
    updatedAt: String!
  }

  input CreateSlackAgentChannelBindingInput {
    agentId: ULID!
    appLevelToken: String
    botToken: String!
    appId: ULID!
    signingSecret: String!
    threadRepliesRequireMention: Boolean
  }

  input CreateLarkAgentChannelBindingInput {
    agentId: ULID!
    larkAppId: String!
    appSecret: String!
    connectionMode: LarkConnectionMode!
    domain: LarkDomain!
    encryptKey: String
    appId: ULID!
    verificationToken: String
  }

  enum LarkConnectionMode {
    webhook
    websocket
  }

  enum LarkDomain {
    feishu
    lark
  }

  enum LarkAppRegistrationStatus {
    access_denied
    confirmed
    expired
    failed
    qr_pending
    slow_down
  }

  type LarkAgentChannelRegistration {
    appId: String
    appSecret: String
    deviceCode: String
    domain: LarkDomain!
    expireIn: Int
    interval: Int
    lastErrorCode: String
    openId: String
    qrUrl: String
    status: LarkAppRegistrationStatus!
    userCode: String
  }

  input StartLarkAgentChannelRegistrationInput {
    agentId: ULID!
    domain: LarkDomain!
    appId: ULID!
  }

  input PollLarkAgentChannelRegistrationInput {
    agentId: ULID!
    deviceCode: String!
    domain: LarkDomain!
    appId: ULID!
  }

  input CreateTelegramAgentChannelBindingInput {
    agentId: ULID!
    botToken: String!
    appId: ULID!
    webhookSecret: String!
  }

  input CreateDiscordAgentChannelBindingInput {
    agentId: ULID!
    applicationId: String!
    botToken: String!
    appId: ULID!
    relaySecret: String!
  }

  enum WeChatQrPairingStatus {
    confirmed
    expired
    failed
    idle
    qr_pending
    scanned
  }

  type WeChatAgentChannelPairing {
    binding: AgentChannelBinding
    lastErrorCode: String
    qrCodeImageSrc: String
    qrToken: String
    status: WeChatQrPairingStatus!
  }

  input StartWeChatAgentChannelPairingInput {
    agentId: ULID!
    appId: ULID!
  }

  input PollWeChatAgentChannelPairingInput {
    agentId: ULID!
    appId: ULID!
    qrToken: String!
  }

  input DeleteAgentChannelBindingInput {
    bindingId: ULID!
    appId: ULID!
  }
`;
