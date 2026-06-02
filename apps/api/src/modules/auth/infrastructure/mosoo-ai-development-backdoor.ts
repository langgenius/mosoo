import { isMosooAiDevelopmentBackdoorEmail } from "@mosoo/development-auth";
import type { BetterAuthPlugin, StandardSchemaV1 } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseUserOutput } from "better-auth/db";

import { logInfo } from "../../../platform/cloudflare/logger";

// arktype lazy-compiles validators via `new Function`, which workerd's V8 isolate
// rejects with `EvalError: Code generation from strings disallowed`. Hand-roll the
// Standard Schema v1 shape that better-auth's `body` field expects instead.
const DevelopmentBackdoorBody: StandardSchemaV1<unknown, { email: string }> = {
  "~standard": {
    version: 1,
    vendor: "mosoo-development-backdoor",
    validate(value: unknown) {
      if (typeof value !== "object" || value === null) {
        return { issues: [{ message: "expected an object", path: [] }] };
      }
      const email = (value as { email?: unknown }).email;
      if (typeof email !== "string") {
        return { issues: [{ message: "email must be a string", path: ["email"] }] };
      }
      return { value: { email } };
    },
  },
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isWellFormedEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

function deriveDevelopmentBackdoorNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "User";
  const normalized = localPart
    .split(/[._-]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

  return normalized || "User";
}

export function mosooAiDevelopmentBackdoorPlugin(): BetterAuthPlugin {
  return {
    endpoints: {
      signInWithMosooAiDevelopmentBackdoor: createAuthEndpoint(
        "/development-backdoor/mosoo-ai-login",
        {
          body: DevelopmentBackdoorBody,
          metadata: {
            openapi: {
              description: "Local development backdoor sign-in for @mosoo.ai emails.",
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          token: {
                            type: "string",
                          },
                          user: {
                            $ref: "#/components/schemas/User",
                          },
                        },
                        required: ["token", "user"],
                        type: "object",
                      },
                    },
                  },
                  description: "Signed in successfully.",
                },
              },
            },
          },
          method: "POST",
        },
        async (ctx) => {
          const email = ctx.body.email.trim().toLowerCase();

          if (!isWellFormedEmail(email) || !isMosooAiDevelopmentBackdoorEmail(email)) {
            throw APIError.fromStatus("NOT_FOUND", { message: "Not found" });
          }

          const existingUser = await ctx.context.internalAdapter.findUserByEmail(email);

          const sessionUser = existingUser
            ? existingUser.user.emailVerified
              ? existingUser.user
              : { ...existingUser.user, emailVerified: true }
            : await ctx.context.internalAdapter.createUser({
                email,
                emailVerified: true,
                name: deriveDevelopmentBackdoorNameFromEmail(email),
              });

          if (existingUser && !existingUser.user.emailVerified) {
            await ctx.context.internalAdapter.updateUser(existingUser.user.id, {
              emailVerified: true,
            });
          }

          const session = await ctx.context.internalAdapter.createSession(sessionUser.id);
          await setSessionCookie(ctx, {
            session,
            user: sessionUser,
          });

          logInfo("auth.development-backdoor.signed-in", {
            email,
            userId: sessionUser.id,
          });

          return ctx.json({
            token: session.token,
            user: parseUserOutput(ctx.context.options, sessionUser),
          });
        },
      ),
    },
    id: "mosoo-ai-development-backdoor",
    version: "1.0.0",
  };
}
