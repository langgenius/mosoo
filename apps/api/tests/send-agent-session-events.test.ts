import { describe, expect, test } from "bun:test";

import { sendAgentSessionEvents } from "../src/modules/runtime/application/session-runs/send-agent-session-events.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";

describe("send agent session events", () => {
  test("returns user message response summaries", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);

    const response = await sendAgentSessionEvents({
      bindings: createPublicHttpTestBindings(database) as ApiBindings,
      executionContext: createTestExecutionContext(),
      input: {
        events: [
          {
            attachmentIds: [],
            clientRequestId: "client-1",
            text: "Run the checklist.",
            type: "user_message",
          },
        ],
        appId: PUBLIC_API_TEST_IDS.app,
        sessionId: "01J0000000000000000000000C",
      },
      requestUrl: "https://api.example.com/api/v1/sessions/01J0000000000000000000000C/events",
      viewer: {
        email: "owner@example.com",
        emailVerified: true,
        id: "01J00000000000000000000001",
        imageUrl: null,
        name: "Owner",
      },
    });

    const eventRun = response.events[0]?.run;

    expect(eventRun).not.toBeNull();
    expect(response.session.lastRun?.id).toBe(eventRun?.id);
    expect(response.session.lastMessageAt).not.toBeNull();
    expect(response.session.status).toBe("RUNNING");
  });

  test("rejects participant sends when the viewer is not the session creator", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await database
      .prepare("UPDATE session SET attributed_user_id = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.memberAccount, PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await expect(
      sendAgentSessionEvents({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        executionContext: createTestExecutionContext(),
        input: {
          events: [
            {
              attachmentIds: [],
              clientRequestId: "client-1",
              text: "Run the checklist.",
              type: "user_message",
            },
          ],
          appId: PUBLIC_API_TEST_IDS.app,
          sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        },
        requestUrl: `https://api.example.com/api/v1/sessions/${PUBLIC_API_TEST_IDS.ownerSession}/events`,
        viewer: {
          email: "member@example.com",
          emailVerified: true,
          id: PUBLIC_API_TEST_IDS.memberAccount,
          imageUrl: null,
          name: "Org Member",
        },
      }),
    ).rejects.toThrow();
  });
});
