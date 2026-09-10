import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { connectAuthenticatedSessionViewerWebSocket } from "../src/modules/sessions/application/session-viewer-socket.service";
import type { SessionViewerSocketConnector } from "../src/modules/sessions/application/session-viewer-socket.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpTestBindings,
  SqliteD1Database,
} from "./helpers/public-api-http-test-fixture";

const ORGANIZATION_ID = "01J00000000000000000000006";
const PROJECT_ID = "01J0000000000000000000000Q";
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
  type: "preview" | "ui";
}): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      archived_at integer,
      attributed_user_id text,
      creator_account_id text NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      project_id text NOT NULL,
      status text NOT NULL,
      type text NOT NULL
    );

    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
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
      project_id,
      status,
      type
    ) VALUES (
      '${SESSION_ID}',
      NULL,
      NULL,
      '${VIEWER_ID}',
      '{}',
      '${PROJECT_ID}',
      'IDLE',
      '${input.type}'
    );

    INSERT INTO project (
      id,
      organization_id,
      owner_account_id,
      name,
      default_environment_id,
      created_at,
      updated_at
    ) VALUES (
      '${PROJECT_ID}',
      '${ORGANIZATION_ID}',
      '${VIEWER_ID}',
      'Default Project',
      NULL,
      1,
      1
    );
  `);

  return database;
}

function createBindings(input: { type: "preview" | "ui" }): ApiBindings {
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
  type: "preview" | "ui";
  viewer?: AuthenticatedViewer;
}): Promise<{
  connectorCallCount: number;
  response: Response;
}> {
  let connectorCallCount = 0;
  const sessionViewerSocketConnector: SessionViewerSocketConnector = async () => {
    connectorCallCount += 1;
    return createSocketResponse(input.responseStatus);
  };

  const response = await connectAuthenticatedSessionViewerWebSocket(createBindings(input), {
    request: new Request(SESSION_VIEWER_SOCKET_URL),
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    sessionViewerSocketConnector,
    viewer: input.viewer ?? VIEWER,
  });

  return {
    connectorCallCount,
    response,
  };
}

describe("session viewer socket subscriptions", () => {
  test.each(["preview", "ui"] as const)(
    "accepts repeated %s subscriptions without runtime bindings",
    async (type) => {
      // The fixture has no Sandbox/Driver runtime. Every reconnect must remain read-only.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { connectorCallCount, response } = await connectForTest({
          responseStatus: 101,
          type,
        });
        expect(connectorCallCount).toBe(1);
        expect(response.status).toBe(101);
      }
    },
  );

  test("preserves a rejected socket response", async () => {
    const { response } = await connectForTest({ responseStatus: 426, type: "preview" });
    expect(response.status).toBe(426);
  });

  test("does not connect when the viewer cannot access the session", async () => {
    let connectorCallCount = 0;
    await expect(
      connectAuthenticatedSessionViewerWebSocket(createBindings({ type: "preview" }), {
        request: new Request(SESSION_VIEWER_SOCKET_URL),
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        sessionViewerSocketConnector: async () => {
          connectorCallCount += 1;
          return createSocketResponse(101);
        },
        viewer: OUTSIDER_VIEWER,
      }),
    ).rejects.toThrow();
    expect(connectorCallCount).toBe(0);
  });
});
