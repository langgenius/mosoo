import { describe, expect, test } from "bun:test";

import { ApiTestClient, createApiTestFixture } from "./helpers/api-test-fixture";

describe("email OTP authentication", () => {
  test("given a new user, when redeeming an emailed OTP, then create a session and reject reuse", async () => {
    const fixture = await createApiTestFixture();
    let deliveredOtp = "";
    const email = "otp.user@example.com";
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

    const sendResponse = await client.postJson("/api/auth/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    expect(sendResponse.status).toBe(200);
    expect(deliveredOtp).toMatch(/^\d{6}$/);
    expect(await client.readAuthenticatedViewerFromSession()).toBeNull();

    const invalidResponse = await client.postJson("/api/auth/sign-in/email-otp", {
      email,
      otp: "invalid-otp",
    });
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.headers.get("set-cookie")).toBeNull();

    const signInResponse = await client.postJson("/api/auth/sign-in/email-otp", {
      email,
      otp: deliveredOtp,
    });
    expect(signInResponse.status).toBe(200);
    expect(await client.readAuthenticatedViewerFromSession()).toMatchObject({
      email,
      emailVerified: true,
    });

    const replayResponse = await client.postJson("/api/auth/sign-in/email-otp", {
      email,
      otp: deliveredOtp,
    });
    expect(replayResponse.status).toBe(400);
    expect(replayResponse.headers.get("set-cookie")).toBeNull();
  });
});
