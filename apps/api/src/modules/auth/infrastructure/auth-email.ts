import { emailLogsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";

import { logInfo, logWarn } from "../../../platform/cloudflare/logger";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";

interface AuthEmailRequest {
  emailType: string;
  subject: string;
  text: string;
  to: string;
}

type AuthEmailSender = string | { email: string; name: string };

interface AuthEmailMessage {
  from: AuthEmailSender;
  subject: string;
  text: string;
  to: string;
}

interface AuthEmailProvider {
  send(input: AuthEmailMessage): Promise<unknown>;
}

export interface AuthEmailBindings {
  readonly AUTH_EMAIL?: AuthEmailProvider;
  readonly AUTH_EMAIL_FROM: string;
  readonly DB: D1Database;
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DISPLAY_NAME_EMAIL_PATTERN = /^(?<name>.+?)\s*<(?<address>[^<>\s@]+@[^<>\s@]+)>$/u;

type EmailProviderStatus = "sent" | "failed";

function normalizeSenderName(name: string): string {
  const trimmedName = name.trim();

  if (trimmedName.startsWith('"') && trimmedName.endsWith('"') && trimmedName.length > 1) {
    return trimmedName.slice(1, -1).trim();
  }

  return trimmedName;
}

function getAuthEmailSender(bindings: AuthEmailBindings): AuthEmailSender {
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
        subject: "Your Mosoo sign-in code",
        text: `Your Mosoo sign-in code is ${otp}. It expires in 10 minutes.`,
      };
    }
    case "email-verification": {
      return {
        subject: "Verify your Mosoo email",
        text: `Your Mosoo email verification code is ${otp}. It expires in 10 minutes.`,
      };
    }
    case "forget-password": {
      return {
        subject: "Your Mosoo password reset code",
        text: `Your Mosoo password reset code is ${otp}. It expires in 10 minutes.`,
      };
    }
    default: {
      return {
        subject: "Your Mosoo verification code",
        text: `Your Mosoo verification code is ${otp}. It expires in 10 minutes.`,
      };
    }
  }
}

function maskEmail(email: string): { domain: string | null; masked: string } {
  const [localPart = "", domain = ""] = email.toLowerCase().split("@");

  if (!domain) {
    return {
      domain: null,
      masked: "***",
    };
  }

  const visiblePrefix = localPart.slice(0, 1) || "*";

  return {
    domain,
    masked: `${visiblePrefix}***@${domain}`,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recordEmailLog(
  bindings: AuthEmailBindings,
  payload: AuthEmailRequest,
  status: EmailProviderStatus,
  provider: string,
  errorMessage: string | null = null,
): Promise<void> {
  const recipient = maskEmail(payload.to);

  try {
    await getAppDatabase(bindings.DB)
      .insert(emailLogsTable)
      .values({
        createdAt: currentTimestampMs(),
        errorMessage,
        id: createPlatformId(),
        provider,
        recipientDomain: recipient.domain,
        recipientMasked: recipient.masked,
        status,
        subject: payload.subject,
        type: payload.emailType,
      })
      .run();
  } catch (error) {
    logWarn("email.log_failed", {
      emailType: payload.emailType,
      error: getErrorMessage(error),
      provider,
      status,
    });
  }
}

async function sendAuthEmail(
  bindings: AuthEmailBindings,
  payload: AuthEmailRequest,
): Promise<void> {
  const emailBinding = bindings.AUTH_EMAIL;

  if (!emailBinding) {
    logInfo("email.dev_console.sent", {
      emailType: payload.emailType,
      recipient: maskEmail(payload.to).masked,
      subject: payload.subject,
      text: payload.text,
    });
    await recordEmailLog(bindings, payload, "sent", "console");
    return;
  }

  try {
    await emailBinding.send({
      from: getAuthEmailSender(bindings),
      subject: payload.subject,
      text: payload.text,
      to: payload.to,
    });
    await recordEmailLog(bindings, payload, "sent", "cloudflare-email");
  } catch (error) {
    await recordEmailLog(bindings, payload, "failed", "cloudflare-email", getErrorMessage(error));
    throw new Error("Failed to send auth email via Cloudflare Email Workers.", {
      cause: error,
    });
  }
}

export async function sendOtpEmail(
  bindings: AuthEmailBindings,
  input: {
    email: string;
    otp: string;
    type: string;
  },
): Promise<void> {
  const message = buildOtpMessage(input.type, input.otp);

  await sendAuthEmail(bindings, {
    emailType: `auth.${input.type}`,
    subject: message.subject,
    text: message.text,
    to: input.email,
  });
}

export async function sendOrganizationInvitationEmail(
  bindings: AuthEmailBindings,
  input: {
    email: string;
    expiresAt: string | null;
    invitedByName: string;
    joinUrl: string;
    organizationName: string;
  },
): Promise<void> {
  const expiresLabel = isTruthy(input.expiresAt)
    ? new Date(input.expiresAt).toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "soon";

  await sendAuthEmail(bindings, {
    emailType: "organization.invitation",
    subject: `Join ${input.organizationName} on Mosoo`,
    text: [
      `${input.invitedByName} invited you to join ${input.organizationName} on Mosoo.`,
      "",
      `Accept the invite: ${input.joinUrl}`,
      "",
      `This invite expires on ${expiresLabel}.`,
    ].join("\n"),
    to: input.email,
  });
}

export async function sendOrganizationAccessDecisionEmail(
  bindings: AuthEmailBindings,
  input: {
    decision: "approved" | "rejected";
    email: string;
    organizationName: string;
  },
): Promise<void> {
  const approved = input.decision === "approved";

  await sendAuthEmail(bindings, {
    emailType: `organization.access_request.${input.decision}`,
    subject: approved
      ? `Your request to join ${input.organizationName} was approved`
      : `Your request to join ${input.organizationName} was not approved`,
    text: approved
      ? `Your request to join ${input.organizationName} on Mosoo was approved. Sign in to continue.`
      : `Your request to join ${input.organizationName} on Mosoo was not approved.`,
    to: input.email,
  });
}
