import { describe, expect, test } from "bun:test";

import { betterAuth } from "better-auth";

import { getBetterAuth } from "../src/modules/auth/infrastructure/better-auth";
import { createApiTestFixture } from "./helpers/api-test-fixture";

describe("development login admission", () => {
  test.each(["http://139.99.68.217:55173", "https://cloud.mosoo.ai"])(
    "given remote WEB_ORIGIN %s, when posting an employee email, then create no session or account",
    async (origin) => {
      const fixture = await createApiTestFixture();
      const response = await getBetterAuth({ ...fixture.bindings, WEB_ORIGIN: origin }).handler(
        new Request(`${origin}/api/auth/development-backdoor/mosoo-ai-login`, {
          body: JSON.stringify({ email: "unauthorized.preview@mosoo.ai" }),
          headers: { "content-type": "application/json", origin },
          method: "POST",
        }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(
        await fixture.database
          .prepare("SELECT id FROM account WHERE email = ?")
          .bind("unauthorized.preview@mosoo.ai")
          .first(),
      ).toBeNull();
      expect(await fixture.database.prepare("SELECT id FROM auth_session").first()).toBeNull();
    },
  );

  test("given loopback WEB_ORIGIN, when an employee signs in, then issue an authenticated session", async () => {
    const fixture = await createApiTestFixture();
    const result = await fixture.client.loginAsMosooAiTestAccount();
    expect(result.user.emailVerified).toBe(true);
    expect(await fixture.client.readAuthenticatedViewerFromSession()).toMatchObject({
      email: result.user.email,
      id: result.user.id,
    });
  });

  test("given a new employee, when signing in twice, then provision once with the development method", async () => {
    const fixture = await createApiTestFixture();
    const provisioningSources: unknown[] = [];
    const auth = betterAuth({
      ...getBetterAuth(fixture.bindings).options,
      user: {
        validateUserInfo: ({ source }) => {
          provisioningSources.push(source);
        },
      },
    });
    const signIn = () =>
      auth.handler(
        new Request(`${fixture.bindings.WEB_ORIGIN}/api/auth/development-backdoor/mosoo-ai-login`, {
          body: JSON.stringify({ email: " New.Employee@mosoo.ai " }),
          headers: { "content-type": "application/json", origin: fixture.bindings.WEB_ORIGIN },
          method: "POST",
        }),
      );

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await signIn();
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("session_token=");
      expect(await response.json()).toMatchObject({
        user: { email: "new.employee@mosoo.ai", emailVerified: true, name: "New Employee" },
      });
    }
    expect(provisioningSources).toEqual([
      { action: "create-user", method: "mosoo-ai-development-backdoor" },
    ]);
    expect(
      await fixture.database
        .prepare("SELECT count(*) AS count FROM account WHERE email = ?")
        .bind("new.employee@mosoo.ai")
        .first(),
    ).toEqual({ count: 1 });
  });

  test("given an unverified employee, when signing in, then verify the existing account", async () => {
    const fixture = await createApiTestFixture();
    await fixture.database
      .prepare("UPDATE account SET email_verified = 0 WHERE id = ?")
      .bind(fixture.viewer.id)
      .run();

    const result = await fixture.client.loginAsMosooAiTestAccount();
    expect(result.user).toMatchObject({ id: fixture.viewer.id, emailVerified: true });
    expect(
      await fixture.database
        .prepare("SELECT email_verified FROM account WHERE id = ?")
        .bind(fixture.viewer.id)
        .first(),
    ).toEqual({ email_verified: 1 });
  });

  test.each(["outsider@example.com", "employee@mosoo.ai.example.com", "invalid"])(
    "given loopback WEB_ORIGIN, when signing in as %s, then reject without creating a session",
    async (email) => {
      const fixture = await createApiTestFixture();
      const response = await fixture.client.postJson(
        "/api/auth/development-backdoor/mosoo-ai-login",
        {
          email,
        },
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await fixture.database.prepare("SELECT id FROM auth_session").first()).toBeNull();
    },
  );
});
