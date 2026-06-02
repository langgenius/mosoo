import { DiscordWebApiError } from "../discord/discord-web-api";
import { isLarkCredentialScopedError, LarkWebApiError } from "../lark/lark-web-api";
import { SlackWebApiError } from "../slack/slack-web-api";
import { isTelegramCredentialScopedError, TelegramWebApiError } from "../telegram/telegram-web-api";
import { WeChatIlinkApiError, WeChatIlinkHttpError } from "../wechat/wechat-ilink-client";
import { WeChatReplyError } from "../wechat/wechat-reply.service";
import type { ChannelSessionCommandClient } from "./channel-session.types";

function shouldMarkSlackBindingError(error: SlackWebApiError): boolean {
  return (
    error.code === "account_inactive" ||
    error.code === "invalid_auth" ||
    error.code === "missing_scope" ||
    error.code === "not_authed" ||
    error.code === "token_revoked"
  );
}

function shouldMarkDiscordBindingError(error: DiscordWebApiError): boolean {
  const code = error.code.toLowerCase();

  return (
    code.includes("401") ||
    code.includes("invalid token") ||
    code.includes("unauthorized") ||
    code.includes("token")
  );
}

export function isCredentialScopedDeliveryError(error: unknown): boolean {
  if (error instanceof DiscordWebApiError) {
    return shouldMarkDiscordBindingError(error);
  }

  if (error instanceof LarkWebApiError) {
    return isLarkCredentialScopedError(error);
  }

  if (error instanceof SlackWebApiError) {
    return shouldMarkSlackBindingError(error);
  }

  if (error instanceof TelegramWebApiError) {
    return isTelegramCredentialScopedError(error);
  }

  if (error instanceof WeChatIlinkApiError) {
    return error.code === "missing_bot_token" || error.code === "ilink_-14";
  }

  if (error instanceof WeChatIlinkHttpError) {
    return error.status === 401 || error.status === 403;
  }

  return false;
}

export async function markBindingErrorIfCredentialScoped(input: {
  error: unknown;
  sessionClient: ChannelSessionCommandClient;
}): Promise<void> {
  if (input.error instanceof DiscordWebApiError && shouldMarkDiscordBindingError(input.error)) {
    await input.sessionClient.markBindingError(input.error.code);
    return;
  }

  if (input.error instanceof LarkWebApiError && isLarkCredentialScopedError(input.error)) {
    await input.sessionClient.markBindingError(input.error.code);
    return;
  }

  if (input.error instanceof SlackWebApiError && shouldMarkSlackBindingError(input.error)) {
    await input.sessionClient.markBindingError(input.error.code);
    return;
  }

  if (input.error instanceof TelegramWebApiError && isTelegramCredentialScopedError(input.error)) {
    await input.sessionClient.markBindingError(input.error.code);
    return;
  }

  if (
    input.error instanceof WeChatIlinkApiError &&
    (input.error.code === "missing_bot_token" || input.error.code === "ilink_-14")
  ) {
    await input.sessionClient.markBindingError(input.error.code);
    return;
  }

  if (
    input.error instanceof WeChatIlinkHttpError &&
    (input.error.status === 401 || input.error.status === 403)
  ) {
    await input.sessionClient.markBindingError(`http_${input.error.status}`);
  }
}

export function getDeliveryErrorCode(error: unknown): string {
  if (error instanceof DiscordWebApiError) {
    return error.code;
  }

  if (error instanceof LarkWebApiError) {
    return error.code;
  }

  if (error instanceof SlackWebApiError) {
    return error.code;
  }

  if (error instanceof TelegramWebApiError) {
    return error.code;
  }

  if (error instanceof WeChatIlinkApiError) {
    return error.code;
  }

  if (error instanceof WeChatIlinkHttpError) {
    return `http_${error.status}`;
  }

  if (error instanceof WeChatReplyError) {
    return error.code;
  }

  if (error instanceof Error) {
    return error.name;
  }

  return "unknown_error";
}
