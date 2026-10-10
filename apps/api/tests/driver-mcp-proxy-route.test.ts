import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { DRIVER_PROTOCOL_VERSION } from "@mosoo/agent-driver/boot";
import {
  driverInstanceMcpGrantsTable,
  driverInstancesTable,
  mcpCredentialsTable,
  mcpServersTable,
  sessionsTable,
} from "@mosoo/db";
import type {
  AccountId,
  CredentialId,
  DriverInstanceId,
  McpServerId,
  ProjectId,
  SandboxId,
  SessionId,
} from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { registerDriverRoute } from "../src/adapters/http/routes/driver-route";
import { RUNTIME_SOCKET_TIMEOUT_MS } from "../src/modules/runtime/domain/runtime-config";
import { getRuntimeDriverMcpProxyPath } from "../src/modules/runtime/domain/runtime-driver-routes";
import { finalizeDriverInstance } from "../src/modules/runtime/infrastructure/driver-instance/lifecycle";
import { createRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import type { RuntimeActionTokenPayload } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { storeSecret } from "../src/modules/vault/application/vault-secret-store";
import type { ApiBindings, ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import { fromBase64Url } from "../src/shared/bytes";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  insertOwnerSession,
  insertSessionRunFixture,
} from "./helpers/public-api-http-test-fixture";

const SERVER_ID = parsePlatformId<McpServerId>("01J00000000000000000000101", "MCP server ID");
const CREDENTIAL_ID = parsePlatformId<CredentialId>(
  "01J00000000000000000000102",
  "MCP credential ID",
);
const DRIVER_INSTANCE_ID = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
const PROJECT_ID = PUBLIC_API_TEST_IDS.project as ProjectId;
const SESSION_ID = PUBLIC_API_TEST_IDS.ownerSession as SessionId;
const GENERATION = 1;
const CONNECTION_ID = "mcp-proxy-test-connection";
const UPSTREAM_ACCESS_TOKEN = "mcp-upstream-secret";
const UPSTREAM_URL = "https://mcp.example.test/rpc";
const REQUEST_BODY = JSON.stringify({
  id: 1,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: { value: "test" }, name: "write_record" },
});
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function setupFixture(endUserId: string | null = null) {
  const database = await createPublicHttpContractDatabase();
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const db = database.app();
  const now = Date.now();
  const secretId = await storeSecret(database, bindings, {
    kind: "mcp_access_token",
    value: UPSTREAM_ACCESS_TOKEN,
  });

  await insertOwnerSession(database);
  await db.update(sessionsTable).set({ endUserId }).where(eq(sessionsTable.id, SESSION_ID)).run();
  await db
    .insert(driverInstancesTable)
    .values({
      bootTokenExpiresAt: now + 60_000,
      bootTokenHash: new TextEncoder().encode(DRIVER_INSTANCE_ID),
      connectionId: CONNECTION_ID,
      createdAt: now,
      expiresAt: now + 60_000,
      generation: GENERATION,
      heartbeatCount: 0,
      id: DRIVER_INSTANCE_ID,
      lastHeartbeatAt: now,
      protocol: "orpc-ws",
      protocolVersion: DRIVER_PROTOCOL_VERSION,
      runtime: "pi",
      sandboxId: PUBLIC_API_TEST_IDS.sandbox as SandboxId,
      sandboxSessionId: SESSION_ID,
      status: "ready",
      updatedAt: now,
    })
    .run();
  await insertSessionRunFixture(database, {
    createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
    driverInstanceId: DRIVER_INSTANCE_ID,
    id: PUBLIC_API_TEST_IDS.run,
    sessionId: SESSION_ID,
    status: "running",
  });
  await db
    .insert(mcpServersTable)
    .values({
      authType: "bearer",
      createdAt: now,
      credentialScope: "app",
      enabled: true,
      id: SERVER_ID,
      name: "MCP proxy test",
      ownerId: PUBLIC_API_TEST_IDS.ownerAccount as AccountId,
      projectId: PROJECT_ID,
      source: "app",
      updatedAt: now,
      url: UPSTREAM_URL,
    })
    .run();
  await db
    .insert(mcpCredentialsTable)
    .values({
      authType: "bearer",
      createdAt: now,
      id: CREDENTIAL_ID,
      projectId: PROJECT_ID,
      scope: "app",
      secretId,
      serverId: SERVER_ID,
      status: "active",
      updatedAt: now,
    })
    .run();
  await db
    .insert(driverInstanceMcpGrantsTable)
    .values({
      authType: "bearer",
      authorizationState: "active",
      createdAt: now,
      credentialId: CREDENTIAL_ID,
      driverInstanceId: DRIVER_INSTANCE_ID,
      projectId: PROJECT_ID,
      serverId: SERVER_ID,
      updatedAt: now,
    })
    .run();

  const grant = await createRuntimeActionToken(bindings, {
    action: "mcp_proxy",
    driverGeneration: GENERATION,
    driverInstanceId: DRIVER_INSTANCE_ID,
    expiresAt: now + 60_000,
    resourceId: SERVER_ID,
  });
  return { bindings, database, grant };
}

function captureUpstreamFetch() {
  const captured: { body: string; headers: Headers; method: string; url: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    captured.push({
      body: await request.text(),
      headers: request.headers,
      method: request.method,
      url: request.url,
    });
    return Response.json({ id: 1, jsonrpc: "2.0", result: { content: [] } });
  }) as typeof fetch;
  return captured;
}

async function dispatch(bindings: ApiBindings, grant: string): Promise<Response> {
  const app = new Hono<ApiGatewayEnvironment>();
  registerDriverRoute(app);
  return app.request(
    new Request(`https://api.example.test${getRuntimeDriverMcpProxyPath(SERVER_ID)}`, {
      body: REQUEST_BODY,
      headers: {
        Authorization: `Bearer ${grant}`,
        "Content-Type": "application/json",
        "X-Mosoo-Delegation": "forged-delegation",
        "X-Mosoo-Tool-Call-Id": "tool-call-1",
      },
      method: "POST",
    }),
    undefined,
    bindings,
    createTestExecutionContext(),
  );
}

describe("driver MCP proxy route", () => {
  test.each([null, "customer-123"])(
    "forwards an active grant using the stored credential and end user %s",
    async (endUserId) => {
      const { bindings, grant } = await setupFixture(endUserId);
      const captured = captureUpstreamFetch();

      const response = await dispatch(bindings, grant);

      expect(response.status).toBe(200);
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        body: REQUEST_BODY,
        method: "POST",
        url: UPSTREAM_URL,
      });
      const headers = captured[0].headers;
      expect(headers.get("Authorization")).toBe(`Bearer ${UPSTREAM_ACCESS_TOKEN}`);
      expect(headers.get("X-Mosoo-Tool-Call-Id")).toBeNull();
      const delegation = headers.get("X-Mosoo-Delegation");
      if (endUserId === null) {
        expect(delegation).toBeNull();
      } else {
        expect(delegation).not.toBeNull();
        const payload = delegation!.split(".")[1];
        expect(JSON.parse(new TextDecoder().decode(fromBase64Url(payload)))).toMatchObject({
          act: { agent_id: PUBLIC_API_TEST_IDS.agent, app_id: PROJECT_ID },
          aud: UPSTREAM_URL,
          run_id: PUBLIC_API_TEST_IDS.run,
          sub: endUserId,
          thread_id: SESSION_ID,
          tool_call_id: "tool-call-1",
        });
      }
    },
  );

  test.each(["stopped", "failed", "deleted", "stale heartbeat", "replaced generation"] as const)(
    "rejects a %s driver before reading grants, credentials or secrets",
    async (state) => {
      const { bindings, database, grant } = await setupFixture();
      const db = database.app();
      if (state === "stopped" || state === "failed") {
        expect(
          await finalizeDriverInstance(bindings, DRIVER_INSTANCE_ID, {
            connectionId: CONNECTION_ID,
            generation: GENERATION,
            heartbeatCount: 0,
            status: state,
          }),
        ).toBe(true);
      } else if (state === "deleted") {
        await db
          .delete(driverInstancesTable)
          .where(eq(driverInstancesTable.id, DRIVER_INSTANCE_ID))
          .run();
      } else {
        await db
          .update(driverInstancesTable)
          .set(
            state === "stale heartbeat"
              ? { lastHeartbeatAt: Date.now() - RUNTIME_SOCKET_TIMEOUT_MS - 1_000 }
              : { generation: GENERATION + 1 },
          )
          .where(eq(driverInstancesTable.id, DRIVER_INSTANCE_ID))
          .run();
      }
      const captured = captureUpstreamFetch();
      const prepare = spyOn(database, "prepare");
      try {
        const response = await dispatch(bindings, grant);

        expect(response.status).toBe(403);
        expect(captured).toHaveLength(0);
        expect(
          prepare.mock.calls.some(([query]) =>
            /driver_instance_mcp_grant|mcp_credential|vault_secret/.test(query),
          ),
        ).toBe(false);
      } finally {
        prepare.mockRestore();
      }
    },
  );

  test.each(["credential", "grant"] as const)("rejects a revoked %s", async (revoked) => {
    const { bindings, database, grant } = await setupFixture();
    const db = database.app();
    if (revoked === "credential") {
      await db
        .update(mcpCredentialsTable)
        .set({ status: "revoked" })
        .where(eq(mcpCredentialsTable.id, CREDENTIAL_ID))
        .run();
    } else {
      await db
        .update(driverInstanceMcpGrantsTable)
        .set({ authorizationState: "revoked" })
        .where(eq(driverInstanceMcpGrantsTable.driverInstanceId, DRIVER_INSTANCE_ID))
        .run();
    }
    const captured = captureUpstreamFetch();

    const response = await dispatch(bindings, grant);

    expect(response.status).toBe(revoked === "credential" ? 401 : 403);
    expect(captured).toHaveLength(0);
  });

  test.each([undefined, null, "1", -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects a signed grant with invalid driver generation %s",
    async (driverGeneration) => {
      const { bindings, database } = await setupFixture();
      const grant = await createRuntimeActionToken(bindings, {
        action: "mcp_proxy",
        driverGeneration,
        driverInstanceId: DRIVER_INSTANCE_ID,
        expiresAt: Date.now() + 60_000,
        resourceId: SERVER_ID,
      } as unknown as RuntimeActionTokenPayload);
      const captured = captureUpstreamFetch();
      const prepare = spyOn(database, "prepare");
      try {
        const response = await dispatch(bindings, grant);

        expect(response.status).toBe(401);
        expect(captured).toHaveLength(0);
        expect(prepare).not.toHaveBeenCalled();
      } finally {
        prepare.mockRestore();
      }
    },
  );
});
