import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { validationError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  normalizeDiscordCredentials,
  serializeDiscordCredentials,
} from "../discord/discord-credentials";
import { DiscordWebApiClient, DiscordWebApiError } from "../discord/discord-web-api";
import type { LarkChannelCredentials } from "../lark/lark-credentials";
import { normalizeLarkCredentials, serializeLarkCredentials } from "../lark/lark-credentials";
import { LarkWebApiClient, LarkWebApiError } from "../lark/lark-web-api";
import { normalizeSlackCredentials, serializeSlackCredentials } from "../slack/slack-credentials";
import { SlackWebApiClient, SlackWebApiError } from "../slack/slack-web-api";
import {
  normalizeTelegramCredentials,
  serializeTelegramCredentials,
} from "../telegram/telegram-credentials";
import { TelegramWebApiClient, TelegramWebApiError } from "../telegram/telegram-web-api";
import {
  buildDiscordDisplayMetadata,
  buildLarkDisplayMetadata,
  buildSlackDisplayMetadata,
  buildTelegramDisplayMetadata,
  createProviderAgentChannelBinding,
  createSlackAppAlreadyConnectedError,
  ensureProviderBindingAvailable,
} from "./agent-channel-binding-records";
import type {
  AgentChannelBinding,
  CreateDiscordAgentChannelBindingInput,
  CreateLarkAgentChannelBindingInput,
  CreateSlackAgentChannelBindingInput,
  CreateTelegramAgentChannelBindingInput,
} from "./agent-channel-binding.types";

async function testSlackIdentity(botToken: string): ReturnType<SlackWebApiClient["authTest"]> {
  try {
    return await new SlackWebApiClient(botToken).authTest();
  } catch (error) {
    if (error instanceof SlackWebApiError && error.operation === "auth.test") {
      throw validationError(error.message, "SLACK_AUTH_TEST_FAILED");
    }

    throw error;
  }
}

async function testLarkIdentity(input: LarkChannelCredentials): Promise<{
  appName: string | null;
  botOpenId: string;
}> {
  const client = new LarkWebApiClient(input);

  try {
    return await client.getBotInfo(await client.getTenantAccessToken());
  } catch (error) {
    if (error instanceof LarkWebApiError) {
      throw validationError(error.message, "LARK_AUTH_TEST_FAILED");
    }

    if (error instanceof Error) {
      logError("channel.lark.identity_check_failed", createErrorLogContext(error));
      throw validationError(
        `Lark identity check failed: ${error.message}`,
        "LARK_AUTH_TEST_FAILED",
      );
    }

    throw validationError("Lark identity check failed.", "LARK_AUTH_TEST_FAILED");
  }
}

async function testTelegramIdentity(botToken: string): ReturnType<TelegramWebApiClient["getMe"]> {
  try {
    return await new TelegramWebApiClient(botToken).getMe();
  } catch (error) {
    if (error instanceof TelegramWebApiError && error.operation === "getMe") {
      throw validationError(error.message, "TELEGRAM_AUTH_TEST_FAILED");
    }

    throw error;
  }
}

async function testDiscordIdentity(
  botToken: string,
): ReturnType<DiscordWebApiClient["getCurrentBotUser"]> {
  try {
    const identity = await new DiscordWebApiClient(botToken).getCurrentBotUser();

    if (!identity.bot) {
      throw validationError(
        "Discord credentials must belong to a bot user.",
        "DISCORD_AUTH_TEST_NOT_BOT",
      );
    }

    return identity;
  } catch (error) {
    if (error instanceof DiscordWebApiError && error.operation === "getCurrentBotUser") {
      throw validationError(error.message, "DISCORD_AUTH_TEST_FAILED");
    }

    throw error;
  }
}

export async function createSlackAgentChannelBinding(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateSlackAgentChannelBindingInput,
): Promise<AgentChannelBinding> {
  const access = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  if (access.agent.status !== "published") {
    throw validationError("Publish the Agent before connecting Slack.", "AGENT_NOT_PUBLISHED");
  }

  const credentials = normalizeSlackCredentials(input);

  await ensureProviderBindingAvailable(bindings.DB, {
    agentId: input.agentId,
    provider: "slack",
  });

  const slackIdentity = await testSlackIdentity(credentials.botToken);
  const externalBotId = slackIdentity.userId ?? slackIdentity.botId;

  if (!isTruthy(externalBotId)) {
    throw validationError(
      "Slack auth.test did not return a bot user id.",
      "SLACK_AUTH_TEST_MISSING_BOT",
    );
  }

  const externalTenantId = slackIdentity.teamId;

  if (!isTruthy(externalTenantId)) {
    throw validationError(
      "Slack auth.test did not return a team id.",
      "SLACK_AUTH_TEST_MISSING_TEAM",
    );
  }

  return createProviderAgentChannelBinding({
    access,
    bindings,
    credentialsJson: serializeSlackCredentials(credentials),
    createAppBindingConflictError: createSlackAppAlreadyConnectedError,
    displayMetadata: buildSlackDisplayMetadata({
      botHandle: slackIdentity.user,
      workspaceName: slackIdentity.team,
    }),
    externalBotId,
    externalTenantId,
    provider: "slack",
    viewer,
  });
}

export async function createLarkAgentChannelBinding(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateLarkAgentChannelBindingInput,
): Promise<AgentChannelBinding> {
  const access = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  if (access.agent.status !== "published") {
    throw validationError(
      "Publish the Agent before connecting Lark / Feishu.",
      "AGENT_NOT_PUBLISHED",
    );
  }

  await ensureProviderBindingAvailable(bindings.DB, {
    agentId: input.agentId,
    provider: "lark",
  });

  const credentials = normalizeLarkCredentials(input);
  const identity = await testLarkIdentity(credentials);

  return createProviderAgentChannelBinding({
    access,
    bindings,
    credentialsJson: serializeLarkCredentials(credentials),
    displayMetadata: buildLarkDisplayMetadata({
      appName: identity.appName,
      botOpenId: identity.botOpenId,
      domain: credentials.domain,
    }),
    externalBotId: identity.botOpenId,
    externalTenantId: `${credentials.domain}:${credentials.appId}`,
    provider: "lark",
    viewer,
  });
}

export async function createTelegramAgentChannelBinding(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateTelegramAgentChannelBindingInput,
): Promise<AgentChannelBinding> {
  const access = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  if (access.agent.status !== "published") {
    throw validationError("Publish the Agent before connecting Telegram.", "AGENT_NOT_PUBLISHED");
  }

  await ensureProviderBindingAvailable(bindings.DB, {
    agentId: input.agentId,
    provider: "telegram",
  });

  const credentials = normalizeTelegramCredentials(input);
  const identity = await testTelegramIdentity(credentials.botToken);

  return createProviderAgentChannelBinding({
    access,
    bindings,
    credentialsJson: serializeTelegramCredentials(credentials),
    displayMetadata: buildTelegramDisplayMetadata({
      botFirstName: identity.firstName,
      botUsername: identity.username,
    }),
    externalBotId: identity.id,
    externalTenantId: identity.id,
    provider: "telegram",
    viewer,
  });
}

export async function createDiscordAgentChannelBinding(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateDiscordAgentChannelBindingInput,
): Promise<AgentChannelBinding> {
  const access = await ensureAgentEditor(bindings.DB, viewer.id, input.agentId);

  if (access.agent.status !== "published") {
    throw validationError("Publish the Agent before connecting Discord.", "AGENT_NOT_PUBLISHED");
  }

  await ensureProviderBindingAvailable(bindings.DB, {
    agentId: input.agentId,
    provider: "discord",
  });

  const credentials = normalizeDiscordCredentials(input);
  const identity = await testDiscordIdentity(credentials.botToken);

  return createProviderAgentChannelBinding({
    access,
    bindings,
    credentialsJson: serializeDiscordCredentials(credentials),
    displayMetadata: buildDiscordDisplayMetadata({
      applicationId: credentials.applicationId,
      botUsername: identity.username,
    }),
    externalBotId: identity.id,
    externalTenantId: credentials.applicationId,
    provider: "discord",
    viewer,
  });
}
