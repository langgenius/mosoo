import { describe, expect, test } from "bun:test";

import { getBetterAuth } from "../src/modules/auth/application/auth-session.service";
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
});
