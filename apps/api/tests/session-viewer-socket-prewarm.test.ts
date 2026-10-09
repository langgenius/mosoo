import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { connectAuthenticatedSessionViewerWebSocket } from "../src/modules/sessions/application/session-viewer-socket.service";
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
      agent_id text,
      archived_at integer,
      attributed_user_id text,
      creator_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL DEFAULT 'gpt-5.4',
      project_id text NOT NULL,
      provider text NOT NULL DEFAULT 'openai',
      runtime_id text NOT NULL DEFAULT 'openai-runtime',
      status text NOT NULL,
      type text NOT NULL,
      updated_at integer NOT NULL DEFAULT 1
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

function createSocketResponse(status: number): Response {
  if (status !== 101) {
    return new Response(null, { status });
  }

  return { status } as Response;
}

// The Session Durable Object is a stub; the fixture has no Sandbox or Driver
// runtime, so any compute wake would fail.
function createBindings(input: { responseStatus: number; type: "preview" | "ui" }): {
  bindings: ApiBindings;
  connectorCallCount: () => number;
} {
  let connectorCallCount = 0;

  return {
    bindings: {
      ...(createPublicHttpTestBindings(
        createSessionViewerSocketPrewarmDatabase(input),
      ) as ApiBindings),
      Session: {
        get: () => ({
          fetch: async () => {
            connectorCallCount += 1;
            return createSocketResponse(input.responseStatus);
          },
        }),
        idFromName: (name: string) => name,
      } as unknown as ApiBindings["Session"],
    },
    connectorCallCount: () => connectorCallCount,
  };
}

async function connectForTest(input: { responseStatus: number; type: "preview" | "ui" }): Promise<{
  connectorCallCount: number;
  response: Response;
}> {
  const { bindings, connectorCallCount } = createBindings(input);
  const response = await connectAuthenticatedSessionViewerWebSocket(bindings, {
    request: new Request(SESSION_VIEWER_SOCKET_URL),
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    viewer: VIEWER,
  });

  return {
    connectorCallCount: connectorCallCount(),
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
    const { bindings, connectorCallCount } = createBindings({
      responseStatus: 101,
      type: "preview",
    });

    await expect(
      connectAuthenticatedSessionViewerWebSocket(bindings, {
        request: new Request(SESSION_VIEWER_SOCKET_URL),
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        viewer: OUTSIDER_VIEWER,
      }),
    ).rejects.toThrow();
    expect(connectorCallCount()).toBe(0);
  });
});
