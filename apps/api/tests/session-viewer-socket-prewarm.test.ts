import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  connectAuthenticatedSessionViewerWebSocket,
  shouldSchedulePreviewRuntimePrewarmForViewerSocket,
} from "../src/modules/sessions/application/session-viewer-socket.service";
import type {
  SessionViewerSocketConnector,
  SessionViewerSocketRuntimePrewarmRequest,
} from "../src/modules/sessions/application/session-viewer-socket.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpTestBindings,
  createTestExecutionContext,
  SqliteD1Database,
} from "./helpers/published-agent-http-test-fixture";

const ORGANIZATION_ID = "01J00000000000000000000006";
const SESSION_ID = "01J000000000000000000000M1";
const SESSION_VIEWER_SOCKET_URL = `https://api.example.com/api/ag-ui/session/${SESSION_ID}/ws`;
const VIEWER_ID = "01J000000000000000000000M2";

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: VIEWER_ID,
  imageUrl: null,
  name: "Viewer",
};

const OUTSIDER_VIEWER: AuthenticatedViewer = {
  email: "outsider@example.com",
  emailVerified: true,
  id: "01J00000000000000000000005",
  imageUrl: null,
  name: "Outsider",
};

function createSessionViewerSocketPrewarmDatabase(input: {
  type: "api_channel" | "preview" | "ui";
}): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      archived_at integer,
      attributed_user_id text,
      creator_account_id text NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      organization_id text NOT NULL,
      status text NOT NULL,
      type text NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

    INSERT INTO session (
      id,
      archived_at,
      attributed_user_id,
      creator_account_id,
      metadata_json,
      organization_id,
      status,
      type
    ) VALUES (
      '${SESSION_ID}',
      NULL,
      NULL,
      '${VIEWER_ID}',
      '{}',
      '${ORGANIZATION_ID}',
      'IDLE',
      '${input.type}'
    );

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    ) VALUES (
      '${ORGANIZATION_ID}',
      '${VIEWER_ID}',
      'member',
      NULL
    );
  `);

  return database;
}

function createBindings(input: { type: "api_channel" | "preview" | "ui" }): ApiBindings {
  return createPublicHttpTestBindings(
    createSessionViewerSocketPrewarmDatabase(input),
  ) as ApiBindings;
}

function createSocketResponse(status: number): Response {
  if (status !== 101) {
    return new Response(null, { status });
  }

  return { status } as Response;
}

async function connectForTest(input: {
  responseStatus: number;
  type: "api_channel" | "preview" | "ui";
  viewer?: AuthenticatedViewer;
}): Promise<{
  connectorCallCount: number;
  response: Response;
  scheduledRequest: SessionViewerSocketRuntimePrewarmRequest | null;
}> {
  const executionContext = createTestExecutionContext();
  let connectorCallCount = 0;
  let scheduledRequest: SessionViewerSocketRuntimePrewarmRequest | null = null;
  const sessionViewerSocketConnector: SessionViewerSocketConnector = async () => {
    connectorCallCount += 1;
    return createSocketResponse(input.responseStatus);
  };

  const response = await connectAuthenticatedSessionViewerWebSocket(createBindings(input), {
    executionContext,
    request: new Request(SESSION_VIEWER_SOCKET_URL),
    runtimePrewarmScheduler: (request) => {
      scheduledRequest = request;
    },
    sessionId: SESSION_ID,
    sessionViewerSocketConnector,
    viewer: input.viewer ?? VIEWER,
  });

  return {
    connectorCallCount,
    response,
    scheduledRequest,
  };
}

describe("session viewer socket runtime prewarm", () => {
  test("schedules prewarm only after an active preview viewer socket is accepted", async () => {
    const { connectorCallCount, response, scheduledRequest } = await connectForTest({
      responseStatus: 101,
      type: "preview",
    });

    expect(connectorCallCount).toBe(1);
    expect(response.status).toBe(101);
    expect(scheduledRequest).not.toBeNull();
    if (!scheduledRequest) {
      throw new Error("Expected accepted preview viewer socket to schedule runtime prewarm.");
    }

    expect(scheduledRequest.requestUrl).toBe(SESSION_VIEWER_SOCKET_URL);
    expect(scheduledRequest.session).toEqual({
      id: SESSION_ID,
      organizationId: ORGANIZATION_ID,
    });
    expect(scheduledRequest.viewer).toBe(VIEWER);
  });

  test("does not schedule prewarm when the preview viewer socket is rejected", async () => {
    const { connectorCallCount, response, scheduledRequest } = await connectForTest({
      responseStatus: 426,
      type: "preview",
    });

    expect(connectorCallCount).toBe(1);
    expect(response.status).toBe(426);
    expect(scheduledRequest).toBeNull();
    expect(
      shouldSchedulePreviewRuntimePrewarmForViewerSocket({
        responseStatus: 426,
        sessionType: "preview",
      }),
    ).toBe(false);
  });

  test.each(["api_channel", "ui"] as const)(
    "does not schedule prewarm for accepted %s viewer sockets",
    async (type) => {
      const { connectorCallCount, response, scheduledRequest } = await connectForTest({
        responseStatus: 101,
        type,
      });

      expect(connectorCallCount).toBe(1);
      expect(response.status).toBe(101);
      expect(scheduledRequest).toBeNull();
      expect(
        shouldSchedulePreviewRuntimePrewarmForViewerSocket({
          responseStatus: 101,
          sessionType: type,
        }),
      ).toBe(false);
    },
  );

  test("does not connect or prewarm when the viewer cannot access the session", async () => {
    let scheduledRequest: SessionViewerSocketRuntimePrewarmRequest | null = null;
    let connectorCallCount = 0;
    const sessionViewerSocketConnector: SessionViewerSocketConnector = async () => {
      connectorCallCount += 1;
      return createSocketResponse(101);
    };

    await expect(
      connectAuthenticatedSessionViewerWebSocket(createBindings({ type: "preview" }), {
        executionContext: createTestExecutionContext(),
        request: new Request(SESSION_VIEWER_SOCKET_URL),
        runtimePrewarmScheduler: (request) => {
          scheduledRequest = request;
        },
        sessionId: SESSION_ID,
        sessionViewerSocketConnector,
        viewer: OUTSIDER_VIEWER,
      }),
    ).rejects.toThrow();

    expect(connectorCallCount).toBe(0);
    expect(scheduledRequest).toBeNull();
  });
});
