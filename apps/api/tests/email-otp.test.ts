import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";

import { getBetterAuth } from "../src/modules/auth/infrastructure/better-auth";
import { ApiTestClient, createApiTestFixture } from "./helpers/api-test-fixture";

async function createEmailOtpFixture(recipient?: string) {
  const fixture = await createApiTestFixture();
  const email = recipient ?? fixture.viewer.email;
  let deliveredOtp = "";
  const client = new ApiTestClient({
    ...fixture.bindings,
    AUTH_EMAIL: {
      async send(message: EmailMessage | EmailMessageBuilder) {
        expect(message.to).toBe(email);
        if (!("text" in message) || typeof message.text !== "string") {
          throw new Error("Expected a text OTP email");
        }
        deliveredOtp = message.text.match(/\b\d{6}\b/)?.[0] ?? "";
        return { messageId: "test-otp-email" };
      },
    },
  });

  const response = await client.postJson("/api/auth/email-otp/send-verification-otp", {
    email,
    type: "sign-in",
  });
  expect(response.status).toBe(200);
  expect(deliveredOtp).toMatch(/^\d{6}$/);
  expect(await client.readAuthenticatedViewerFromSession()).toBeNull();
  return { ...fixture, client, email, otp: deliveredOtp };
}

describe("email OTP authentication", () => {
  test("given a new user, when redeeming an emailed OTP, then create a session and reject reuse", async () => {
    const { client, email, otp } = await createEmailOtpFixture("otp.user@example.com");

    const invalidResponse = await client.postJson("/api/auth/sign-in/email-otp", {
      email,
      otp: "invalid-otp",
    });
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.headers.get("set-cookie")).toBeNull();

    const signInResponse = await client.postJson("/api/auth/sign-in/email-otp", {
      email,
      otp,
    });
    expect(signInResponse.status).toBe(200);
    expect(await client.readAuthenticatedViewerFromSession()).toMatchObject({
      email,
      emailVerified: true,
    });

    const replayResponse = await client.postJson("/api/auth/sign-in/email-otp", {
      email,
      otp,
    });
    expect(replayResponse.status).toBe(400);
    expect(replayResponse.headers.get("set-cookie")).toBeNull();
  });

  test("given an existing user, when checking a valid OTP, then preserve it for sign-in without creating a session", async () => {
    const { client, email, otp } = await createEmailOtpFixture();
    const response = await client.postJson("/api/auth/email-otp/check-verification-otp", {
      email,
      otp,
      type: "sign-in",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await client.readAuthenticatedViewerFromSession()).toBeNull();

    const signIn = await client.postJson("/api/auth/sign-in/email-otp", { email, otp });
    expect(signIn.status).toBe(200);
    expect(await client.readAuthenticatedViewerFromSession()).toMatchObject({ email });
  });

  test("given exhausted preflight guesses, when signing in with the real OTP, then reject without a session", async () => {
    const { client, database, email, otp } = await createEmailOtpFixture();
    const wrongOtp = otp === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await client.postJson("/api/auth/email-otp/check-verification-otp", {
        email,
        otp: wrongOtp,
        type: "sign-in",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_OTP" });
      expect(response.headers.get("set-cookie")).toBeNull();
    }

    const signIn = await client.postJson("/api/auth/sign-in/email-otp", { email, otp });
    expect(signIn.status).toBe(403);
    expect(await signIn.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    expect(signIn.headers.get("set-cookie")).toBeNull();
    expect(await client.readAuthenticatedViewerFromSession()).toBeNull();
    expect(await database.prepare("SELECT id FROM auth_session").first()).toBeNull();

    const replay = await client.postJson("/api/auth/sign-in/email-otp", { email, otp });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ code: "INVALID_OTP" });
  });

  test("given an in-flight OTP check, when another guess races it, then compare only the first guess", async () => {
    const fixture = await createApiTestFixture();
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let checking = false;
    let comparisons = 0;
    const options = getBetterAuth(fixture.bindings).options;
    const auth = betterAuth({
      ...options,
      plugins: [
        ...options.plugins.filter((plugin) => plugin.id !== "email-otp"),
        emailOTP({
          generateOTP: () => "123456",
          sendVerificationOTP: async () => {},
          // Pause comparison, not storage, so the same Drizzle/D1 adapter must
          // exclude the racing request before it can test a second guess.
          storeOTP: {
            async hash(otp) {
              if (checking) {
                comparisons++;
                if (comparisons === 1) {
                  entered.resolve();
                  await resume.promise;
                }
              }
              return createHash("sha256").update(otp).digest("hex");
            },
          },
        }),
      ],
    });
    const post = (path: string, otp?: string) =>
      auth.handler(
        new Request(`${fixture.bindings.WEB_ORIGIN}/api/auth/email-otp/${path}`, {
          body: JSON.stringify({ email: fixture.viewer.email, otp, type: "sign-in" }),
          headers: { "content-type": "application/json", origin: fixture.bindings.WEB_ORIGIN },
          method: "POST",
        }),
      );
    expect((await post("send-verification-otp")).status).toBe(200);
    checking = true;
    const first = post("check-verification-otp", "000000");
    let second: Response;
    try {
      await entered.promise;
      second = await post("check-verification-otp", "111111");
    } finally {
      resume.resolve();
    }
    const firstResponse = await first;
    expect(firstResponse.status).toBe(400);
    expect(second.status).toBe(400);
    expect(await firstResponse.json()).toMatchObject({ code: "INVALID_OTP" });
    expect(await second.json()).toMatchObject({ code: "INVALID_OTP" });
    expect(firstResponse.headers.get("set-cookie")).toBeNull();
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(comparisons).toBe(1);
    expect(await fixture.database.prepare("SELECT value FROM auth_verification").first()).toEqual({
      value: `${createHash("sha256").update("123456").digest("hex")}:1`,
    });
    expect(await fixture.database.prepare("SELECT id FROM auth_session").first()).toBeNull();
  });
});
