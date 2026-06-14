import type { PrimitiveRecord } from "@mosoo/contracts";
import type { AgentChannelBindingProvider, AgentChannelBindingStatus } from "@mosoo/db";
import type { AgentId, ChannelBindingId, AppId } from "@mosoo/id";

import type { LarkAppRegistrationStatus } from "../lark/lark-app-registration";
import type { LarkConnectionMode } from "../lark/lark-credentials";
import type { LarkDomain } from "../lark/lark-events";
import type { WeChatQrPairingStatus } from "../wechat/wechat-runtime";

export interface CreateSlackAgentChannelBindingInput {
  agentId: AgentId;
  appLevelToken?: string | null;
  botToken: string;
  appId: AppId;
  signingSecret: string;
  threadRepliesRequireMention?: boolean | null;
}

export interface CreateLarkAgentChannelBindingInput {
  agentId: AgentId;
  larkAppId: string;
  appSecret: string;
  connectionMode: LarkConnectionMode;
  domain: LarkDomain;
  encryptKey: string | null;
  appId: AppId;
  verificationToken: string | null;
}

export interface StartLarkAgentChannelRegistrationInput {
  agentId: AgentId;
  domain: LarkDomain;
  appId: AppId;
}

export interface PollLarkAgentChannelRegistrationInput {
  agentId: AgentId;
  deviceCode: string;
  domain: LarkDomain;
  appId: AppId;
}

export interface CreateTelegramAgentChannelBindingInput {
  agentId: AgentId;
  botToken: string;
  appId: AppId;
  webhookSecret: string;
}

export interface CreateDiscordAgentChannelBindingInput {
  agentId: AgentId;
  applicationId: string;
  botToken: string;
  appId: AppId;
  relaySecret: string;
}

export interface StartWeChatAgentChannelPairingInput {
  agentId: AgentId;
  appId: AppId;
}

export interface PollWeChatAgentChannelPairingInput {
  agentId: AgentId;
  appId: AppId;
  qrToken: string;
}

export interface DeleteAgentChannelBindingInput {
  bindingId: ChannelBindingId;
  appId: AppId;
}

export interface RecordAgentChannelBindingErrorInput {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  errorCode: string;
  appId: AppId;
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
  appId: AppId;
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
