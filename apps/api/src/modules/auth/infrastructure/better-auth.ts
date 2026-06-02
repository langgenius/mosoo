import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";
import {
  accountsTable,
  authAccountsTable,
  authSessionsTable,
  authVerificationsTable,
} from "@mosoo/db";
import { isDevelopmentBackdoorLoopbackOrigin } from "@mosoo/development-auth";
import { createPlatformId } from "@mosoo/id";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins/email-otp";

import { logInfo, logWarn } from "../../../platform/cloudflare/logger";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthEmailBindings } from "./auth-email";
import { sendOtpEmail } from "./auth-email";
import { mosooAiDevelopmentBackdoorPlugin } from "./mosoo-ai-development-backdoor";

export interface AuthBindings extends AuthEmailBindings {
  readonly BETTER_AUTH_SECRET?: string;
  readonly GOOGLE_OAUTH_CLIENT_ID?: string;
  readonly GOOGLE_OAUTH_CLIENT_SECRET?: string;
  readonly WEB_ORIGIN: string;
}

const authCache = new WeakMap<D1Database, ReturnType<typeof createAppAuth>>();

function toAccountTimestamp(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function serializeAccountTimestampFields<T extends Record<string, unknown>>(data: T): T {
  return {
    ...data,
    createdAt: toAccountTimestamp(data["createdAt"]),
    updatedAt: toAccountTimestamp(data["updatedAt"]),
  };
}

function serializeAccountUpdateTimestampFields<T extends Record<string, unknown>>(data: T): T {
  return serializeAccountTimestampFields({
    ...data,
    updatedAt: data["updatedAt"] ?? new Date(),
  });
}

function getBetterAuthSecret(bindings: AuthBindings): string {
  const secret = bindings.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required.");
  }

  return secret;
}

export function isBetterAuthConfigured(
  bindings: Pick<AuthBindings, "BETTER_AUTH_SECRET">,
): boolean {
  return Boolean(bindings.BETTER_AUTH_SECRET?.trim());
}

function createAppAuth(bindings: AuthBindings) {
  const googleClientId = bindings.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const googleClientSecret = bindings.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const authPlugins: BetterAuthPlugin[] = [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        await sendOtpEmail(bindings, {
          email,
          otp,
          type,
        });
      },
    }),
  ];

  if (isDevelopmentBackdoorLoopbackOrigin(bindings.WEB_ORIGIN)) {
    logWarn("auth.development-backdoor.enabled", {
      webOrigin: bindings.WEB_ORIGIN,
    });
    authPlugins.unshift(mosooAiDevelopmentBackdoorPlugin());
  }

  const schema = {
    account: authAccountsTable,
    session: authSessionsTable,
    user: accountsTable,
    verification: authVerificationsTable,
  };
  const database = getAppDatabase(bindings.DB);

  return betterAuth({
    advanced: {
      database: {
        generateId: () => createPlatformId(),
      },
    },
    basePath: `${PUBLIC_API_PREFIX}/auth`,
    baseURL: bindings.WEB_ORIGIN,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: serializeAccountTimestampFields(user),
          }),
        },
        update: {
          before: async (user) => ({
            data: serializeAccountUpdateTimestampFields(user),
          }),
        },
      },
    },
    plugins: authPlugins,
    secret: getBetterAuthSecret(bindings),
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
      expiresIn: 30 * 24 * 60 * 60,
    },
    ...(googleClientId && googleClientSecret
      ? {
          socialProviders: {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            },
          },
        }
      : {}),
    trustedOrigins: isDevelopmentBackdoorLoopbackOrigin(bindings.WEB_ORIGIN)
      ? (request?: Request) => {
          const origin = request?.headers.get("origin") ?? null;
          return origin !== null && isDevelopmentBackdoorLoopbackOrigin(origin)
            ? [origin]
            : [bindings.WEB_ORIGIN];
        }
      : [bindings.WEB_ORIGIN],
  });
}

export function getBetterAuth(bindings: AuthBindings) {
  const cached = authCache.get(bindings.DB);

  if (cached) {
    return cached;
  }

  const auth = createAppAuth(bindings);
  authCache.set(bindings.DB, auth);
  logInfo("auth.initialized", {
    googleOAuthConfigured: Boolean(
      bindings.GOOGLE_OAUTH_CLIENT_ID?.trim() && bindings.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
    ),
    webOrigin: bindings.WEB_ORIGIN,
  });
  return auth;
}
