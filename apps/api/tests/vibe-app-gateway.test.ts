import { afterEach, describe, expect, test } from "bun:test";

import type { Server, ServerWebSocket } from "bun";

import type {
  VibesdkGateway,
  VibesdkGatewayTimeouts,
} from "../src/modules/apps/application/vibesdk-gateway";
import { createVibesdkGateway } from "../src/modules/apps/application/vibesdk-gateway";
import { API_ERROR_CODE } from "../src/platform/errors";
import { expectApiErrorCode } from "./helpers/api-error-assert";

const TEST_API_KEY = "vibe_test_key";
const TEST_AGENT_ID = "vibe-agent-1";
const FAST_TIMEOUTS: VibesdkGatewayTimeouts = {
  commandAckMs: 400,
  createMs: 3_000,
  generationStartedMs: 400,
};

type WsMode = "ack" | "silent";

interface FakeVibesdkOptions {
  appData?: Record<string, unknown>;
  appGetBody?: { error?: { message: string }; success: boolean };
  buildStatus?: number;
  deleteStatus?: number;
  wsMode?: WsMode;
}

interface FakeVibesdk {
  attempts: Record<string, number>;
  baseUrl: string;
  deleted: string[];
  received: { type: string }[];
  stop(): void;
  ticketQueries: string[];
}

const runningServers: Server[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function startFakeVibesdk(options: FakeVibesdkOptions = {}): FakeVibesdk {
  const attempts: Record<string, number> = {};
  const deleted: string[] = [];
  const received: { type: string }[] = [];
  const ticketQueries: string[] = [];
  const wsMode = options.wsMode ?? "ack";

  const countAttempt = (key: string) => {
    attempts[key] = (attempts[key] ?? 0) + 1;
  };

  const server = Bun.serve<{ agentId: string }, object>({
    fetch(request, srv) {
      const url = new URL(request.url);
      const { method } = request;

      if (url.pathname === "/api/auth/exchange-api-key" && method === "POST") {
        if (request.headers.get("Authorization") !== `Bearer ${TEST_API_KEY}`) {
          return new Response("bad key", { status: 401 });
        }

        return jsonResponse({
          data: {
            accessToken: "jwt-test-token",
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
          success: true,
        });
      }

      if (url.pathname === "/api/agent" && method === "POST") {
        countAttempt("build");

        if (options.buildStatus !== undefined) {
          return new Response("build rejected", { status: options.buildStatus });
        }

        const start = {
          agentId: TEST_AGENT_ID,
          behaviorType: "phasic",
          projectType: "app",
          websocketUrl: `ws://localhost:${srv.port}/ws/${TEST_AGENT_ID}`,
        };
        const chunk = { chunk: "# Blueprint\n" };
        return new Response(`${JSON.stringify(start)}\n${JSON.stringify(chunk)}\n`, {
          headers: { "Content-Type": "application/x-ndjson" },
        });
      }

      const connectMatch = /^\/api\/agent\/([^/]+)\/connect$/.exec(url.pathname);

      if (connectMatch && method === "GET") {
        return jsonResponse({
          data: {
            agentId: connectMatch[1],
            websocketUrl: `ws://localhost:${srv.port}/ws/${connectMatch[1]}`,
          },
          success: true,
        });
      }

      if (url.pathname === "/api/ws-ticket" && method === "POST") {
        return jsonResponse({ data: { ticket: "ticket-test" }, success: true });
      }

      const cloneMatch = /^\/api\/apps\/([^/]+)\/git\/token$/.exec(url.pathname);

      if (cloneMatch && method === "POST") {
        return jsonResponse({
          data: {
            cloneUrl: `https://git.vibesdk.test/${cloneMatch[1]}.git`,
            expiresAt: "2026-07-12T01:00:00.000Z",
            expiresIn: 3600,
            token: "clone-token",
          },
          success: true,
        });
      }

      const appMatch = /^\/api\/apps\/([^/]+)$/.exec(url.pathname);

      if (appMatch && method === "GET") {
        if (options.appGetBody !== undefined) {
          return jsonResponse(options.appGetBody);
        }

        return jsonResponse({
          data: {
            cloudflareUrl: null,
            id: appMatch[1],
            previewUrl: null,
            status: "generating",
            title: null,
            updatedAt: null,
            ...options.appData,
          },
          success: true,
        });
      }

      if (appMatch && method === "DELETE") {
        if (options.deleteStatus !== undefined && options.deleteStatus !== 200) {
          return new Response("delete rejected", { status: options.deleteStatus });
        }

        deleted.push(appMatch[1] ?? "");
        return jsonResponse({ data: { deleted: true }, success: true });
      }

      const wsMatch = /^\/ws\/([^/]+)$/.exec(url.pathname);

      if (wsMatch) {
        ticketQueries.push(url.searchParams.get("ticket") ?? "");

        if (srv.upgrade(request, { data: { agentId: wsMatch[1] ?? "" } })) {
          return undefined as unknown as Response;
        }

        return new Response("upgrade failed", { status: 400 });
      }

      return new Response("not found", { status: 404 });
    },
    port: 0,
    websocket: {
      message(ws: ServerWebSocket<{ agentId: string }>, raw) {
        const message = JSON.parse(String(raw)) as { type: string };
        received.push(message);

        if (wsMode === "silent") {
          return;
        }

        if (message.type === "generate_all") {
          ws.send(
            JSON.stringify({ message: "started", totalFiles: 3, type: "generation_started" }),
          );
        }

        if (message.type === "get_conversation_state") {
          ws.send(JSON.stringify({ state: { messages: [] }, type: "conversation_state" }));
        }
      },
    },
  });

  runningServers.push(server);

  return {
    attempts,
    baseUrl: `http://localhost:${server.port}`,
    deleted,
    received,
    stop: () => server.stop(true),
    ticketQueries,
  };
}

function createGateway(fake: FakeVibesdk, apiKey = TEST_API_KEY): VibesdkGateway {
  const gateway = createVibesdkGateway(
    { VIBESDK_API_KEY: apiKey, VIBESDK_BASE_URL: fake.baseUrl },
    FAST_TIMEOUTS,
  );

  if (gateway === null) {
    throw new Error("Expected a configured gateway.");
  }

  return gateway;
}

afterEach(() => {
  for (const server of runningServers.splice(0)) {
    server.stop(true);
  }
});

describe("vibesdk gateway configuration", () => {
  const factoryCases = [
    { apiKey: undefined, baseUrl: undefined, expected: "null", name: "both missing" },
    { apiKey: "", baseUrl: "  ", expected: "null", name: "both blank" },
    { apiKey: "vibe_x", baseUrl: undefined, expected: "throw", name: "base url missing" },
    { apiKey: undefined, baseUrl: "https://vibe.test", expected: "throw", name: "api key missing" },
  ] as const;

  for (const { apiKey, baseUrl, expected, name } of factoryCases) {
    test(`factory handles ${name}`, () => {
      const build = () =>
        createVibesdkGateway({ VIBESDK_API_KEY: apiKey, VIBESDK_BASE_URL: baseUrl });

      if (expected === "null") {
        expect(build()).toBeNull();
      } else {
        expect(build).toThrow("VIBESDK_BASE_URL and VIBESDK_API_KEY");
      }
    });
  }
});

describe("vibesdk gateway createApp", () => {
  test("builds, kicks generation, and returns the vibe app id", async () => {
    const fake = startFakeVibesdk();
    const gateway = createGateway(fake);

    const vibeAppId = await gateway.createApp("Build a todo app");

    expect(vibeAppId).toBe(TEST_AGENT_ID);
    expect(fake.received.map((message) => message.type)).toContain("generate_all");
    expect(fake.ticketQueries).toEqual(["ticket-test"]);
    expect(fake.deleted).toEqual([]);
  });

  test("compensates with a remote delete when generation never starts", async () => {
    const fake = startFakeVibesdk({ wsMode: "silent" });
    const gateway = createGateway(fake);

    await expectApiErrorCode(
      gateway.createApp("Build a todo app"),
      API_ERROR_CODE.vibeAppUnavailable,
    );
    expect(fake.deleted).toEqual([TEST_AGENT_ID]);
  });

  test("fails without compensation when the build request is rejected", async () => {
    const fake = startFakeVibesdk({ buildStatus: 400 });
    const gateway = createGateway(fake);

    await expectApiErrorCode(
      gateway.createApp("Build a todo app"),
      API_ERROR_CODE.vibeAppUnavailable,
    );
    expect(fake.deleted).toEqual([]);
    expect(fake.attempts["build"]).toBe(1);
  });

  test("does not retry the non-idempotent build request on a server error", async () => {
    const fake = startFakeVibesdk({ buildStatus: 500 });
    const gateway = createGateway(fake);

    await expectApiErrorCode(
      gateway.createApp("Build a todo app"),
      API_ERROR_CODE.vibeAppUnavailable,
    );
    expect(fake.attempts["build"]).toBe(1);
  });

  test("surfaces an invalid platform api key", async () => {
    const fake = startFakeVibesdk();
    const gateway = createGateway(fake, "vibe_wrong_key");

    await expectApiErrorCode(
      gateway.createApp("Build a todo app"),
      API_ERROR_CODE.vibeAppUnavailable,
    );
  });
});

describe("vibesdk gateway status reads", () => {
  const snapshotCases = [] as {
    cloudflareUrl: string | null;
    expectedStatus: "generating" | "ready";
    name: string;
    previewUrl: string | null;
    status: "completed" | "generating";
  }[];

  for (const status of ["generating", "completed"] as const) {
    for (const previewUrl of [null, "https://preview.vibesdk.test"]) {
      for (const cloudflareUrl of [null, "https://live.vibesdk.test"]) {
        snapshotCases.push({
          cloudflareUrl,
          expectedStatus: status === "completed" ? "ready" : "generating",
          name: `${status} preview=${previewUrl !== null} live=${cloudflareUrl !== null}`,
          previewUrl,
          status,
        });
      }
    }
  }

  for (const testCase of snapshotCases) {
    test(`maps ${testCase.name}`, async () => {
      const fake = startFakeVibesdk({
        appData: {
          cloudflareUrl: testCase.cloudflareUrl,
          previewUrl: testCase.previewUrl,
          status: testCase.status,
          title: "Todo App",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      });
      const gateway = createGateway(fake);

      const snapshot = await gateway.getApp(TEST_AGENT_ID);

      expect(snapshot).toEqual({
        previewUrl: testCase.previewUrl,
        productionUrl: testCase.cloudflareUrl,
        status: testCase.expectedStatus,
        title: "Todo App",
        updatedAt: "2026-07-12T00:00:00.000Z",
      });
    });
  }

  test("rejects an unrecognized status", async () => {
    const fake = startFakeVibesdk({ appData: { status: "archived" } });
    const gateway = createGateway(fake);

    await expectApiErrorCode(gateway.getApp(TEST_AGENT_ID), API_ERROR_CODE.vibeAppUnavailable);
  });

  test("surfaces an unsuccessful app read", async () => {
    const fake = startFakeVibesdk({
      appGetBody: { error: { message: "App not visible" }, success: false },
    });
    const gateway = createGateway(fake);

    await expectApiErrorCode(gateway.getApp(TEST_AGENT_ID), API_ERROR_CODE.vibeAppUnavailable);
  });
});

describe("vibesdk gateway commands", () => {
  const commandCases = [
    {
      expectedWsType: "user_suggestion",
      name: "sendPrompt",
      run: (gateway: VibesdkGateway) => gateway.sendPrompt(TEST_AGENT_ID, "Add dark mode"),
    },
    {
      expectedWsType: "deploy",
      name: "publish",
      run: (gateway: VibesdkGateway) => gateway.publish(TEST_AGENT_ID),
    },
    {
      expectedWsType: "preview",
      name: "refreshPreview",
      run: (gateway: VibesdkGateway) => gateway.refreshPreview(TEST_AGENT_ID),
    },
  ] as const;

  for (const { expectedWsType, name, run } of commandCases) {
    test(`${name} delivers the command before disconnecting`, async () => {
      const fake = startFakeVibesdk();
      const gateway = createGateway(fake);

      await run(gateway);

      const types = fake.received.map((message) => message.type);
      expect(types).toEqual([expectedWsType, "get_conversation_state"]);
    });

    test(`${name} fails when the agent never acknowledges`, async () => {
      const fake = startFakeVibesdk({ wsMode: "silent" });
      const gateway = createGateway(fake);

      await expectApiErrorCode(run(gateway), API_ERROR_CODE.vibeAppUnavailable);
    });
  }
});

describe("vibesdk gateway app management", () => {
  test("delete removes the remote app", async () => {
    const fake = startFakeVibesdk();
    const gateway = createGateway(fake);

    await gateway.deleteApp(TEST_AGENT_ID);

    expect(fake.deleted).toEqual([TEST_AGENT_ID]);
  });

  test("delete tolerates an already-missing remote app", async () => {
    const fake = startFakeVibesdk({ deleteStatus: 404 });
    const gateway = createGateway(fake);

    await gateway.deleteApp(TEST_AGENT_ID);

    expect(fake.deleted).toEqual([]);
  });

  test("delete surfaces server failures", async () => {
    const fake = startFakeVibesdk({ deleteStatus: 503 });
    const gateway = createGateway(fake);

    await expectApiErrorCode(gateway.deleteApp(TEST_AGENT_ID), API_ERROR_CODE.vibeAppUnavailable);
  });

  test("clone url returns the minted token", async () => {
    const fake = startFakeVibesdk();
    const gateway = createGateway(fake);

    const result = await gateway.createCloneUrl(TEST_AGENT_ID);

    expect(result).toEqual({
      cloneUrl: `https://git.vibesdk.test/${TEST_AGENT_ID}.git`,
      expiresAt: "2026-07-12T01:00:00.000Z",
    });
  });
});
