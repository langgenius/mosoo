import { accountsTable, agentChannelBindingsTable, agentsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, ChannelBindingId, OrganizationId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AgentRow } from "../../agents/application/agent-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { SlackChannelCredentials } from "../slack/slack-credentials";
import { parseSlackCredentials } from "../slack/slack-credentials";
import type { SlackWorkTrigger } from "../slack/slack-events";
import type {
  SlackAdapterConfig,
  SlackSessionCommandClient,
} from "../slack/slack-first-party-adapter";
import { readAgentChannelBindingCredentialSecret } from "./channel-credential-secret-resolution";
import { parseChannelDisplayMetadata } from "./channel-display-metadata";
import { createChannelSessionClient } from "./channel-session-command-client";
import type { AgentChannelBindingContext, ChannelWorkTrigger } from "./channel-session.types";

export interface SlackChannelBindingContext {
  agentId: AgentId;
  agentStatus: AgentRow["status"];
  bindingId: ChannelBindingId;
  botHandle: string | null;
  credentials: SlackChannelCredentials;
  externalBotId: string;
  externalTenantId: string;
  owner: AuthenticatedViewer;
  threadRepliesRequireMention: boolean;
  workspaceName: string | null;
}

interface SlackDisplayMetadata {
  bot_handle: string | null;
  workspace_name: string | null;
}

function readOptionalMetadataString(
  value: ReturnType<typeof parseChannelDisplayMetadata>,
  field: string,
): string | null {
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function parseSlackDisplayMetadata(value: string): SlackDisplayMetadata {
  const metadata = parseChannelDisplayMetadata(value);

  return {
    bot_handle: readOptionalMetadataString(metadata, "bot_handle"),
    workspace_name: readOptionalMetadataString(metadata, "workspace_name"),
  };
}

function toOwnerViewer(row: {
  email: string;
  emailVerified: boolean | number;
  id: AccountId;
  imageUrl: string | null;
  name: string;
}): AuthenticatedViewer {
  return {
    email: row.email,
    emailVerified: row.emailVerified === true || row.emailVerified === 1,
    id: row.id,
    imageUrl: row.imageUrl,
    name: row.name,
  };
}

function toExternalThreadId(trigger: SlackWorkTrigger): string {
  return `${trigger.channelId}:${trigger.threadTs}`;
}

function toAgentChannelBindingContext(
  binding: SlackChannelBindingContext,
): AgentChannelBindingContext {
  return {
    agentId: binding.agentId,
    agentStatus: binding.agentStatus,
    bindingId: binding.bindingId,
    credentialsJson: JSON.stringify(binding.credentials),
    displayMetadata: {
      bot_handle: binding.botHandle,
      workspace_name: binding.workspaceName,
    },
    externalBotId: binding.externalBotId,
    externalTenantId: binding.externalTenantId,
    owner: binding.owner,
    provider: "slack",
  };
}

function toChannelWorkTrigger(trigger: SlackWorkTrigger): ChannelWorkTrigger {
  return {
    eventId: trigger.eventId,
    externalActorId: `slack:${trigger.userId}`,
    externalMessageId: trigger.messageTs,
    externalThreadId: toExternalThreadId(trigger),
    providerMetadata: {
      channel_id: trigger.channelId,
      channel_name: null,
      enterprise_id: trigger.enterpriseId,
      is_enterprise_install: trigger.isEnterpriseInstall,
      team_id: trigger.teamId,
    },
    requiresExistingSession: trigger.requiresExistingSession,
  };
}

async function toSlackChannelBindingContext(
  bindings: ApiBindings,
  row: {
    agentId: AgentId;
    agentStatus: AgentRow["status"];
    bindingId: ChannelBindingId;
    displayMetadataJson: string;
    encryptedCredsSecretId: string;
    externalBotId: string;
    externalTenantId: string;
    organizationId: OrganizationId;
    ownerEmail: string;
    ownerEmailVerified: boolean | number;
    ownerId: AccountId;
    ownerImageUrl: string | null;
    ownerName: string;
  },
): Promise<SlackChannelBindingContext> {
  const metadata = parseSlackDisplayMetadata(row.displayMetadataJson);
  const credentials = parseSlackCredentials(
    await readAgentChannelBindingCredentialSecret(bindings, {
      bindingId: row.bindingId,
      expectedOwner: {
        agentId: row.agentId,
        organizationId: row.organizationId,
      },
      provider: "slack",
      purpose: "channel_callback",
      secretId: parsePlatformId(row.encryptedCredsSecretId, "Slack binding credential secret ID"),
    }),
  );

  return {
    agentId: row.agentId,
    agentStatus: row.agentStatus,
    bindingId: row.bindingId,
    botHandle: metadata.bot_handle,
    credentials,
    externalBotId: row.externalBotId,
    externalTenantId: row.externalTenantId,
    owner: toOwnerViewer({
      email: row.ownerEmail,
      emailVerified: row.ownerEmailVerified,
      id: row.ownerId,
      imageUrl: row.ownerImageUrl,
      name: row.ownerName,
    }),
    threadRepliesRequireMention: credentials.threadRepliesRequireMention,
    workspaceName: metadata.workspace_name,
  };
}

export async function resolveSlackChannelBindingContext(
  bindings: ApiBindings,
  input: {
    externalBotId: string;
    externalTenantId: string;
  },
): Promise<SlackChannelBindingContext | null> {
  const botId = input.externalBotId.trim();
  const tenantId = input.externalTenantId.trim();

  if (!botId || !tenantId) {
    return null;
  }

  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        agentId: agentChannelBindingsTable.agentId,
        agentStatus: agentsTable.status,
        bindingId: agentChannelBindingsTable.id,
        displayMetadataJson: agentChannelBindingsTable.displayMetadataJson,
        encryptedCredsSecretId: agentChannelBindingsTable.encryptedCredsSecretId,
        externalBotId: agentChannelBindingsTable.externalBotId,
        externalTenantId: agentChannelBindingsTable.externalTenantId,
        organizationId: agentsTable.organizationId,
        ownerEmail: accountsTable.email,
        ownerEmailVerified: accountsTable.emailVerified,
        ownerId: accountsTable.id,
        ownerImageUrl: accountsTable.image,
        ownerName: accountsTable.name,
      })
      .from(agentChannelBindingsTable)
      .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
      .innerJoin(accountsTable, eq(accountsTable.id, agentsTable.ownerId))
      .where(
        and(
          eq(agentChannelBindingsTable.provider, "slack"),
          eq(agentChannelBindingsTable.externalTenantId, tenantId),
          eq(agentChannelBindingsTable.externalBotId, botId),
          eq(agentChannelBindingsTable.status, "active"),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return toSlackChannelBindingContext(bindings, {
    ...row,
    organizationId: row.organizationId as OrganizationId,
  });
}

export async function resolveSlackChannelBindingContextById(
  bindings: ApiBindings,
  input: {
    bindingId: ChannelBindingId;
  },
): Promise<SlackChannelBindingContext | null> {
  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        agentId: agentChannelBindingsTable.agentId,
        agentStatus: agentsTable.status,
        bindingId: agentChannelBindingsTable.id,
        displayMetadataJson: agentChannelBindingsTable.displayMetadataJson,
        encryptedCredsSecretId: agentChannelBindingsTable.encryptedCredsSecretId,
        externalBotId: agentChannelBindingsTable.externalBotId,
        externalTenantId: agentChannelBindingsTable.externalTenantId,
        organizationId: agentsTable.organizationId,
        ownerEmail: accountsTable.email,
        ownerEmailVerified: accountsTable.emailVerified,
        ownerId: accountsTable.id,
        ownerImageUrl: accountsTable.image,
        ownerName: accountsTable.name,
      })
      .from(agentChannelBindingsTable)
      .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
      .innerJoin(accountsTable, eq(accountsTable.id, agentsTable.ownerId))
      .where(
        and(
          eq(agentChannelBindingsTable.id, input.bindingId),
          eq(agentChannelBindingsTable.provider, "slack"),
          eq(agentChannelBindingsTable.status, "active"),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return toSlackChannelBindingContext(bindings, {
    ...row,
    organizationId: row.organizationId as OrganizationId,
  });
}

export function createSlackAdapterConfig(input: {
  binding: SlackChannelBindingContext;
  sessionLinkBaseUrl: string | null;
}): SlackAdapterConfig {
  return {
    agentId: input.binding.agentId,
    bindingId: input.binding.bindingId,
    sessionLinkBaseUrl: input.sessionLinkBaseUrl,
    slackBotToken: input.binding.credentials.botToken,
  };
}

export function createSlackChannelSessionClient(input: {
  binding: SlackChannelBindingContext;
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  requestUrl: string;
}): SlackSessionCommandClient {
  const channelClient = createChannelSessionClient({
    binding: toAgentChannelBindingContext(input.binding),
    bindings: input.bindings,
    executionContext: input.executionContext,
    requestUrl: input.requestUrl,
  });

  return {
    async createOrContinueSession(command) {
      if (command.trigger.requiresExistingSession && input.binding.threadRepliesRequireMention) {
        logInfo("slack-channel-events.thread_reply_ignored", {
          agentId: input.binding.agentId,
          bindingId: input.binding.bindingId,
          channelId: command.trigger.channelId,
          eventId: command.trigger.eventId,
          reason: "mention_required",
          teamId: command.trigger.teamId,
          threadTs: command.trigger.threadTs,
        });
        return { duplicate: false, ignored: true, runId: null, sessionId: null };
      }

      return channelClient.createOrContinueSession({
        clientRequestId: command.clientRequestId,
        text: command.text,
        trigger: toChannelWorkTrigger(command.trigger),
      });
    },
    markBindingError: channelClient.markBindingError,
    retrieveSessionReply: channelClient.retrieveSessionReply,
  };
}
