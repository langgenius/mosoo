import { describe, expect, test } from "bun:test";

import { Hono } from "hono";

import { registerDriverRoute } from "../src/adapters/http/routes/driver-route";
import {
  platformIdRouteErrorMessage,
  platformIdRouteErrorResponse,
} from "../src/adapters/http/routes/platform-id-route-error";
import { registerTelegramEventsRoute } from "../src/adapters/http/routes/telegram-events-route";
import { createRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import type { ApiBindings, ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
} from "./helpers/public-api-http-test-fixture";

function createDriverRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  registerDriverRoute(app);
  return app;
}

function createTelegramRouteTestApp(): Hono<ApiGatewayEnvironment> {
  const app = new Hono<ApiGatewayEnvironment>();
  const publicApi = new Hono<ApiGatewayEnvironment>();
  registerTelegramEventsRoute(publicApi);
  app.route("/api", publicApi);
  return app;
}

describe("HTTP route platform ID errors", () => {
  test("recognizes platform ID parse errors without swallowing unrelated TypeErrors", () => {
    expect(platformIdRouteErrorMessage(new TypeError("Agent ID must be a valid ULID."))).toBe(
      "Agent ID must be a valid ULID.",
    );
    expect(platformIdRouteErrorMessage(new TypeError("Body stream already read."))).toBeNull();

    const response = platformIdRouteErrorResponse(
      new TypeError("Thread ID must be a ULID string."),
      (message) => ({ error: message }),
    );

    expect(response?.status).toBe(400);
  });

  test("maps malformed driver route IDs to 400", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const grant = await createRuntimeActionToken(bindings, {
      action: "skill_snapshot",
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      expiresAt: Date.now() + 60_000,
      resourceId: PUBLIC_API_TEST_IDS.file,
    });
    const response = await createDriverRouteTestApp().request(
      new Request(`https://api.example.com/api/driver/skill/not-a-ulid/package?grant=${grant}`),
      undefined,
      bindings,
      createTestExecutionContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Skill snapshot ID must be a valid ULID.",
    });
  });

  test("maps malformed channel route IDs to 400", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const response = await createTelegramRouteTestApp().request(
      new Request("https://api.example.com/api/v1/channels/telegram/events/not-a-ulid", {
        body: "{}",
        method: "POST",
      }),
      undefined,
      bindings,
      createTestExecutionContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "invalid_request",
      error: "Channel binding ID must be a valid ULID.",
      ok: false,
    });
  });
});
