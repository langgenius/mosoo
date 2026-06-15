import type { PrimitiveRecord } from "@mosoo/contracts";
import { agentChannelBindingsTable, sessionsTable } from "@mosoo/db";
import type { AgentChannelBindingProvider } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AgentId, ChannelBindingId, PlatformId, AppId } from "@mosoo/id";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import {
  errorMessageChainIncludes,
  notFoundError,
  validationError,
} from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import { ensureAppAgentOwner } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { AgentChannelBinding } from "./agent-channel-binding.types";
import {
  cleanupStoredAgentChannelBindingCredentialSecret,
  storeAgentChannelBindingCredentialSecret,
} from "./channel-credential-secret-resolution";
import { parseChannelDisplayMetadata } from "./channel-display-metadata";

interface AgentChannelBindingActivity {
  lastTriggeredAt: string | null;
  sessionCount7d: number;
}

type AppAgentOwnerAccess = Awaited<ReturnType<typeof ensureAppAgentOwner>>;

const AGENT_CHANNEL_BINDING_PROVIDER_LABELS = {
  discord: "Discord",
  lark: "Lark / Feishu",
  slack: "Slack",
  telegram: "Telegram",
  wechat: "WeChat",
} satisfies Record<AgentChannelBindingProvider, string>;

function getAgentChannelBindingProviderLabel(provider: AgentChannelBindingProvider): string {
  return AGENT_CHANNEL_BINDING_PROVIDER_LABELS[provider];
}

function createAgentChannelBindingExistsError(provider: AgentChannelBindingProvider): Error {
  return validationError(
    `${getAgentChannelBindingProviderLabel(provider)} is already connected to this Agent.`,
    "AGENT_CHANNEL_BINDING_ALREADY_EXISTS",
  );
}

export function createSlackAppAlreadyConnectedError(): Error {
  return validationError("This Slack app is already connected to an Agent.", "SLACK_APP_BOUND");
}

function createChannelAppAlreadyConnectedError(): Error {
  return validationError("This channel app is already connected to an Agent.", "CHANNEL_APP_BOUND");
}

async function cleanupStoredChannelBindingSecret(input: {
  agentId: AgentId;
  database: D1Database;
  provider: AgentChannelBindingProvider;
  appId: AppId;
  secretId: PlatformId;
}): Promise<void> {
  await cleanupStoredAgentChannelBindingCredentialSecret({
    command: {
      agentId: input.agentId,
      provider: input.provider,
      appId: input.appId,
      purpose: "channel_binding_create_rollback",
      secretId: input.secretId,
    },
    database: input.database,
  });
}

function errorIncludes(error: unknown, fragment: string): boolean {
  return errorMessageChainIncludes(error, [fragment]);
}

function isAgentProviderConflict(error: unknown): boolean {
  return (
    errorIncludes(error, "agent_channel_binding_agent_provider_idx") ||
    (errorIncludes(error, "agent_channel_binding.agent_id") &&
      errorIncludes(error, "agent_channel_binding.provider") &&
      !errorIncludes(error, "agent_channel_binding.external_tenant_id"))
  );
}

function isProviderAppBindingConflict(error: unknown): boolean {
  return (
    errorIncludes(error, "agent_channel_binding_provider_tenant_bot_idx") ||
    (errorIncludes(error, "agent_channel_binding.provider") &&
      errorIncludes(error, "agent_channel_binding.external_tenant_id") &&
      errorIncludes(error, "agent_channel_binding.external_bot_id"))
  );
}

export function buildSlackDisplayMetadata(input: {
  botHandle: string | null;
  workspaceName: string | null;
}): PrimitiveRecord {
  return {
    bot_handle: input.botHandle,
    workspace_name: input.workspaceName,
  };
}

export function buildLarkDisplayMetadata(input: {
  appName: string | null;
  botOpenId: string;
  domain: string;
}): PrimitiveRecord {
  return {
    app_name: input.appName,
    bot_open_id: input.botOpenId,
    domain: input.domain,
  };
}

export function buildTelegramDisplayMetadata(input: {
  botFirstName: string | null;
  botUsername: string | null;
}): PrimitiveRecord {
  return {
    bot_first_name: input.botFirstName,
    bot_username: input.botUsername,
  };
}

export function buildDiscordDisplayMetadata(input: {
  applicationId: string;
  botUsername: string | null;
}): PrimitiveRecord {
  return {
    application_id: input.applicationId,
    bot_username: input.botUsername,
  };
}

export async function ensureProviderBindingAvailable(
  database: D1Database,
  input: {
    agentId: AgentId;
    createAppBindingConflictError?: (() => Error) | undefined;
    externalBotId?: string;
    externalTenantId?: string;
    appId: AppId;
    provider: AgentChannelBindingProvider;
  },
): Promise<void> {
  const databaseClient = getAppDatabase(database);
  const agentBinding = await databaseClient
    .select({ id: agentChannelBindingsTable.id })
    .from(agentChannelBindingsTable)
    .where(
      and(
        eq(agentChannelBindingsTable.agentId, input.agentId),
        eq(agentChannelBindingsTable.appId, input.appId),
        eq(agentChannelBindingsTable.provider, input.provider),
      ),
    )
    .limit(1)
    .get();

  if (agentBinding) {
    throw createAgentChannelBindingExistsError(input.provider);
  }

  if (!input.externalBotId || !input.externalTenantId) {
    return;
  }

  const appBinding = await databaseClient
    .select({ id: agentChannelBindingsTable.id })
    .from(agentChannelBindingsTable)
    .where(
      and(
        eq(agentChannelBindingsTable.provider, input.provider),
        eq(agentChannelBindingsTable.externalTenantId, input.externalTenantId),
        eq(agentChannelBindingsTable.externalBotId, input.externalBotId),
      ),
    )
    .limit(1)
    .get();

  if (appBinding) {
    throw (input.createAppBindingConflictError ?? createChannelAppAlreadyConnectedError)();
  }
}

function toAgentChannelBinding(
  row: typeof agentChannelBindingsTable.$inferSelect,
  activity: AgentChannelBindingActivity = {
    lastTriggeredAt: null,
    sessionCount7d: 0,
  },
): AgentChannelBinding {
  return {
    activityLastTriggeredAt: activity.lastTriggeredAt,
    activitySessionCount7d: activity.sessionCount7d,
    agentId: row.agentId,
    createdAt: toIsoString(row.createdAt),
    displayMetadata: parseChannelDisplayMetadata(row.displayMetadataJson),
    externalBotId: row.externalBotId,
    externalTenantId: row.externalTenantId,
    id: row.id,
    lastErrorCode: row.lastErrorCode,
    appId: row.appId,
    provider: row.provider,
    status: row.status,
    updatedAt: toIsoString(row.updatedAt),
  };
}

async function loadAgentChannelBindingActivities(
  database: D1Database,
  input: {
    agentId: AgentId;
    bindingIds: readonly ChannelBindingId[];
  },
): Promise<Map<string, AgentChannelBindingActivity>> {
  if (input.bindingIds.length === 0) {
    return new Map();
  }

  const sevenDaysAgoMs = currentTimestampMs() - 7 * 24 * 60 * 60 * 1000;
  const bindingIdExpression = sql<string>`json_extract(${sessionsTable.metadataJson}, '$.triggered_by.binding_id')`;
  const rows = await getAppDatabase(database)
    .select({
      bindingId: bindingIdExpression,
      lastCreatedAt: sql<number | string | null>`max(${sessionsTable.createdAt})`,
      sessionCount7d: sql<
        number | string
      >`sum(case when ${sessionsTable.createdAt} >= ${sevenDaysAgoMs} then 1 else 0 end)`,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.agentId, input.agentId),
        eq(sessionsTable.type, "api_channel"),
        inArray(bindingIdExpression, input.bindingIds),
      ),
    )
    .groupBy(bindingIdExpression)
    .all();

  const activityByBindingId = new Map<string, AgentChannelBindingActivity>();

  for (const row of rows) {
    activityByBindingId.set(row.bindingId, {
      lastTriggeredAt: row.lastCreatedAt ? toIsoString(row.lastCreatedAt) : null,
      sessionCount7d: Number(row.sessionCount7d),
    });
  }

  return activityByBindingId;
}

export async function listAgentChannelBindings(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    appId: AppId;
  },
): Promise<AgentChannelBinding[]> {
  await ensureAppAgentOwner(database, viewer.id, input);
  const rows = await getAppDatabase(database)
    .select()
    .from(agentChannelBindingsTable)
    .where(
      and(
        eq(agentChannelBindingsTable.agentId, input.agentId),
        eq(agentChannelBindingsTable.appId, input.appId),
      ),
    )
    .orderBy(asc(agentChannelBindingsTable.id))
    .all();

  const activityByBindingId = await loadAgentChannelBindingActivities(database, {
    agentId: input.agentId,
    bindingIds: rows.map((row) => row.id),
  });

  return rows.map((row) => toAgentChannelBinding(row, activityByBindingId.get(row.id)));
}

export async function createProviderAgentChannelBinding(input: {
  access: AppAgentOwnerAccess;
  bindings: ApiBindings;
  credentialsJson: string;
  displayMetadata: PrimitiveRecord;
  externalBotId: string;
  externalTenantId: string;
  createAppBindingConflictError?: (() => Error) | undefined;
  provider: AgentChannelBindingProvider;
  viewer: AuthenticatedViewer;
}): Promise<AgentChannelBinding> {
  const agentId = parsePlatformId<AgentId>(input.access.agent.id, "agent ID");
  const appId = parsePlatformId<AppId>(input.access.agent.appId, "app ID");

  await ensureProviderBindingAvailable(input.bindings.DB, {
    agentId,
    appId,
    externalBotId: input.externalBotId,
    externalTenantId: input.externalTenantId,
    createAppBindingConflictError: input.createAppBindingConflictError,
    provider: input.provider,
  });

  const id = createPlatformId<ChannelBindingId>();
  const timestampMs = currentTimestampMs();
  const encryptedCredsSecretId = await storeAgentChannelBindingCredentialSecret(input.bindings, {
    agentId,
    credentialsJson: input.credentialsJson,
    provider: input.provider,
    appId,
    purpose: "channel_binding_create",
  });

  try {
    await getAppDatabase(input.bindings.DB)
      .insert(agentChannelBindingsTable)
      .values({
        agentId,
        createdAt: timestampMs,
        displayMetadataJson: JSON.stringify(input.displayMetadata),
        encryptedCredsSecretId,
        externalBotId: input.externalBotId,
        externalTenantId: input.externalTenantId,
        id,
        lastErrorCode: null,
        provider: input.provider,
        appId,
        status: "active",
        updatedAt: timestampMs,
      })
      .run();
  } catch (error) {
    await cleanupStoredChannelBindingSecret({
      agentId,
      database: input.bindings.DB,
      provider: input.provider,
      appId,
      secretId: encryptedCredsSecretId,
    });
    if (isAgentProviderConflict(error)) {
      throw createAgentChannelBindingExistsError(input.provider);
    }
    if (isProviderAppBindingConflict(error)) {
      throw (input.createAppBindingConflictError ?? createChannelAppAlreadyConnectedError)();
    }
    throw error;
  }

  return readAgentChannelBindingById(input.bindings.DB, id);
}

export async function readAgentChannelBindingById(
  database: D1Database,
  bindingId: ChannelBindingId,
): Promise<AgentChannelBinding> {
  const row =
    (await getAppDatabase(database)
      .select()
      .from(agentChannelBindingsTable)
      .where(eq(agentChannelBindingsTable.id, bindingId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw notFoundError("Agent channel binding could not be loaded.");
  }

  return toAgentChannelBinding(row);
}
