import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DISPLAY_NAME_EMAIL_PATTERN = /^(?<name>.+?)\s*<(?<address>[^<>\s@]+@[^<>\s@]+)>$/u;

function normalizeSenderName(name: string): string {
  const trimmedName = name.trim();

  if (trimmedName.startsWith('"') && trimmedName.endsWith('"') && trimmedName.length > 1) {
    return trimmedName.slice(1, -1).trim();
  }

  return trimmedName;
}

function getAuthEmailSender(bindings: ApiBindings): string | EmailAddress {
  const from = bindings.AUTH_EMAIL_FROM?.trim();

  if (!from) {
    throw new Error("AUTH_EMAIL_FROM is required.");
  }

  if (SIMPLE_EMAIL_PATTERN.test(from)) {
    return from;
  }

  const displayNameMatch = DISPLAY_NAME_EMAIL_PATTERN.exec(from);

  if (!isTruthy(displayNameMatch?.groups?.["address"])) {
    throw new Error(
      "AUTH_EMAIL_FROM must be a plain email address or a display name with an angle-bracket address.",
    );
  }

  const address = displayNameMatch.groups["address"].trim();
  const name = normalizeSenderName(displayNameMatch.groups["name"] ?? "");

  return name
    ? {
        email: address,
        name,
      }
    : address;
}

function buildOtpMessage(type: string, otp: string): { subject: string; text: string } {
  switch (type) {
    case "sign-in": {
      return {
        subject: "Your mosoo sign-in code",
        text: `Your mosoo sign-in code is ${otp}. It expires in 10 minutes.`,
      };
    }
    case "email-verification": {
      return {
        subject: "Verify your mosoo email",
        text: `Your mosoo email verification code is ${otp}. It expires in 10 minutes.`,
      };
    }
    case "forget-password": {
      return {
        subject: "Your mosoo password reset code",
        text: `Your mosoo password reset code is ${otp}. It expires in 10 minutes.`,
      };
    }
    default: {
      return {
        subject: "Your mosoo verification code",
        text: `Your mosoo verification code is ${otp}. It expires in 10 minutes.`,
      };
    }
  }
}

export async function sendOtpEmail(
  bindings: ApiBindings,
  input: {
    email: string;
    otp: string;
    type: string;
  },
): Promise<void> {
  const message = buildOtpMessage(input.type, input.otp);

  try {
    await bindings.AUTH_EMAIL.send({
      from: getAuthEmailSender(bindings),
      subject: message.subject,
      text: message.text,
      to: input.email,
    });
  } catch (error) {
    throw new Error("Failed to send auth email via Cloudflare Email Workers.", {
      cause: error,
    });
  }
}
