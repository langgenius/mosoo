import { describe, expect, test } from "bun:test";

import type { AccountId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { connectOwnerDebugTerminalWebSocket } from "../src/modules/runtime/application/owner-debug-terminal.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { API_ERROR_CODE } from "../src/platform/errors";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  PUBLIC_API_TEST_IDS,
} from "./helpers/published-agent-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount as AccountId,
  imageUrl: null,
  name: "Owner",
};

function ownerDebugTerminalRequest(): Request {
  return new Request("https://api.example.com/api/agent/test/owner-debug-terminal/ws", {
    headers: new Headers([["Upgrade", "websocket"]]),
  });
}

describe("owner debug terminal", () => {
  test("returns an explicit conflict for Cattle agents", async () => {
    const database = await createPublicHttpContractDatabase();
    await database
      .prepare("UPDATE agent SET kind = ? WHERE id = ?")
      .bind("cattle", PUBLIC_API_TEST_IDS.agent)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expect(
      connectOwnerDebugTerminalWebSocket(bindings, {
        agentId: PUBLIC_API_TEST_IDS.agent,
        executionContext: createTestExecutionContext(),
        request: ownerDebugTerminalRequest(),
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toMatchObject({
      code: API_ERROR_CODE.ownerDebugTerminalUnavailable,
      status: 409,
    });
  });
});
