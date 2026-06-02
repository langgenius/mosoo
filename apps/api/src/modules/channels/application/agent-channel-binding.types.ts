import type { PrimitiveRecord } from "@mosoo/contracts";
import type { AgentChannelBindingProvider, AgentChannelBindingStatus } from "@mosoo/db";
import type { AgentId, ChannelBindingId } from "@mosoo/id";

import type { LarkAppRegistrationStatus } from "../lark/lark-app-registration";
import type { LarkConnectionMode } from "../lark/lark-credentials";
import type { LarkDomain } from "../lark/lark-events";
import type { WeChatQrPairingStatus } from "../wechat/wechat-runtime";

export interface CreateSlackAgentChannelBindingInput {
  agentId: AgentId;
  appLevelToken?: string | null;
  botToken: string;
  signingSecret: string;
  threadRepliesRequireMention?: boolean | null;
}

export interface CreateLarkAgentChannelBindingInput {
  agentId: AgentId;
  appId: string;
  appSecret: string;
  connectionMode: LarkConnectionMode;
  domain: LarkDomain;
  encryptKey: string | null;
  verificationToken: string | null;
}

export interface StartLarkAgentChannelRegistrationInput {
  agentId: AgentId;
  domain: LarkDomain;
}

export interface PollLarkAgentChannelRegistrationInput {
  agentId: AgentId;
  deviceCode: string;
  domain: LarkDomain;
}

export interface CreateTelegramAgentChannelBindingInput {
  agentId: AgentId;
  botToken: string;
  webhookSecret: string;
}

export interface CreateDiscordAgentChannelBindingInput {
  agentId: AgentId;
  applicationId: string;
  botToken: string;
  relaySecret: string;
}

export interface StartWeChatAgentChannelPairingInput {
  agentId: AgentId;
}

export interface PollWeChatAgentChannelPairingInput {
  agentId: AgentId;
  qrToken: string;
}

export interface DeleteAgentChannelBindingInput {
  bindingId: ChannelBindingId;
}

export interface RecordAgentChannelBindingErrorInput {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  errorCode: string;
  provider: AgentChannelBindingProvider;
}

export interface AgentChannelBinding {
  activityLastTriggeredAt: string | null;
  activitySessionCount7d: number;
  agentId: AgentId;
  createdAt: string;
  displayMetadata: PrimitiveRecord;
  externalBotId: string;
  externalTenantId: string;
  id: ChannelBindingId;
  lastErrorCode: string | null;
  provider: AgentChannelBindingProvider;
  status: AgentChannelBindingStatus;
  updatedAt: string;
}

export interface WeChatAgentChannelPairing {
  binding: AgentChannelBinding | null;
  lastErrorCode: string | null;
  qrCodeImageSrc: string | null;
  qrToken: string | null;
  status: WeChatQrPairingStatus;
}

export interface LarkAgentChannelRegistration {
  appId: string | null;
  appSecret: string | null;
  deviceCode: string | null;
  domain: LarkDomain;
  expireIn: number | null;
  interval: number | null;
  lastErrorCode: string | null;
  openId: string | null;
  qrUrl: string | null;
  status: LarkAppRegistrationStatus;
  userCode: string | null;
}
