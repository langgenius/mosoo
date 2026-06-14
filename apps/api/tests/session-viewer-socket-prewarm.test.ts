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
} from "./helpers/public-api-http-test-fixture";

const ORGANIZATION_ID = "01J00000000000000000000006";
const APP_ID = "01J0000000000000000000000Q";
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
      app_id text NOT NULL,
      status text NOT NULL,
      type text NOT NULL
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    INSERT INTO session (
      id,
      archived_at,
      attributed_user_id,
      creator_account_id,
      metadata_json,
      app_id,
      status,
      type
    ) VALUES (
      '${SESSION_ID}',
      NULL,
      NULL,
      '${VIEWER_ID}',
      '{}',
      '${APP_ID}',
      'IDLE',
      '${input.type}'
    );

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      slug,
      default_environment_id,
      created_at,
      updated_at
    ) VALUES (
      '${APP_ID}',
      '${ORGANIZATION_ID}',
      '${VIEWER_ID}',
      'Default App',
      'default',
      NULL,
      1,
      1
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
    appId: APP_ID,
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
      appId: APP_ID,
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
        appId: APP_ID,
        sessionId: SESSION_ID,
        sessionViewerSocketConnector,
        viewer: OUTSIDER_VIEWER,
      }),
    ).rejects.toThrow();

    expect(connectorCallCount).toBe(0);
    expect(scheduledRequest).toBeNull();
  });
});
