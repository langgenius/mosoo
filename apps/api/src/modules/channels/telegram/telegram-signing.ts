import { isTruthy } from "../../../shared/truthiness";

export interface TelegramWebhookSecretVerificationInput {
  headers: Headers;
  webhookSecret: string;
}

export interface TelegramWebhookSecretVerificationFailure {
  code: "missing_secret" | "secret_mismatch";
  message: string;
  ok: false;
  status: 400 | 401;
}

export interface TelegramWebhookSecretVerificationSuccess {
  ok: true;
}

export type TelegramWebhookSecretVerificationResult =
  | TelegramWebhookSecretVerificationFailure
  | TelegramWebhookSecretVerificationSuccess;

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes.at(index) ?? 0) ^ (rightBytes.at(index) ?? 0);
  }

  return difference === 0;
}

export function verifyTelegramWebhookSecret(
  input: TelegramWebhookSecretVerificationInput,
): TelegramWebhookSecretVerificationResult {
  const expected = input.webhookSecret.trim();
  const actual = input.headers.get("x-telegram-bot-api-secret-token")?.trim() ?? "";

  if (!isTruthy(expected) || !isTruthy(actual)) {
    return {
      code: "missing_secret",
      message: "Telegram webhook secret token is required.",
      ok: false,
      status: 400,
    };
  }

  if (!timingSafeEqual(actual, expected)) {
    return {
      code: "secret_mismatch",
      message: "Telegram webhook secret token is invalid.",
      ok: false,
      status: 401,
    };
  }

  return { ok: true };
}
