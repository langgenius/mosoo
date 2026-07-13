import { afterEach, describe, expect, test } from "bun:test";

import { allThreadSessions } from "../src/domains/session/api/list";
import { toAppId } from "../src/routes/typed-id";

const APP_ID = "01J000000000000000000000P1";
const AGENT_ID = "01J000000000000000000000A1";
const FIRST_SESSION_ID = "01J000000000000000000000S1";
const SECOND_SESSION_ID = "01J000000000000000000000S2";
const originalFetch = globalThis.fetch;

interface GraphQLRequestBody {
  variables: {
    appId: string;
    archived: boolean;
    beforeCursor: string | null;
    type: string | null;
  };
}

function sessionNode(id: string) {
  return {
    capabilities: [],
    session: {
      agentId: AGENT_ID,
      archivedAt: null,
      createdAt: "2026-07-13T00:00:00.000Z",
      deploymentVersionId: null,
      deploymentVersionNumber: null,
      id,
      kind: "pet",
      lastMessageAt: null,
      lastRun: null,
      model: "gpt-5",
      provider: "openai",
      appId: APP_ID,
      runtimeId: "openai-runtime",
      status: "IDLE",
      title: id,
      type: "ui",
      updatedAt: "2026-07-13T00:00:00.000Z",
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("all Thread sessions", () => {
  test("follows cursors across active and archived Thread pages", async () => {
    const requests: GraphQLRequestBody["variables"][] = [];

    globalThis.fetch = async (_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected a GraphQL request body.");
      }

      const body = JSON.parse(init.body) as GraphQLRequestBody;
      requests.push(body.variables);

      if (body.variables.archived) {
        return Response.json({
          data: {
            threadAgentSessionList: {
              nodes: [],
              pageInfo: { endCursor: null, hasMore: false },
            },
          },
        });
      }

      const firstPage = body.variables.beforeCursor === null;
      return Response.json({
        data: {
          threadAgentSessionList: {
            nodes: [sessionNode(firstPage ? FIRST_SESSION_ID : SECOND_SESSION_ID)],
            pageInfo: {
              endCursor: firstPage ? "page-1" : null,
              hasMore: firstPage,
            },
          },
        },
      });
    };

    const sessions = await allThreadSessions(toAppId(APP_ID));

    expect(sessions.map((entry) => entry.session.id)).toEqual([
      FIRST_SESSION_ID,
      SECOND_SESSION_ID,
    ]);
    expect(requests).toContainEqual({
      archived: true,
      beforeCursor: null,
      type: null,
      appId: APP_ID,
    });
    expect(requests).toContainEqual({
      archived: false,
      beforeCursor: "page-1",
      type: null,
      appId: APP_ID,
    });
  });
});
