import { afterEach, describe, expect, mock, test } from "bun:test";

import type { AccountId, McpServerId, ProjectId } from "@mosoo/id";

import { registerDynamicOAuthClient } from "../src/modules/mcp/application/mcp-oauth-client-registration.service";
import {
  exchangeOAuthToken,
  getOrDiscoverOAuthMetadata,
} from "../src/modules/mcp/application/mcp-oauth-discovery.service";
import type { OAuthMetadata, ServerRow } from "../src/modules/mcp/application/mcp-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const metadata: OAuthMetadata = {
  authorization_endpoint: "https://oauth.example.com/authorize",
  registration_endpoint: "https://oauth.example.com/register",
  token_endpoint: "https://oauth.example.com/token",
};

function server(oauthMetadataJson: string | null): ServerRow {
  return {
    authType: "oauth",
    byoClientId: "test-client",
    byoClientSecretSecretId: null,
    createdAt: 1,
    credentialScope: "app",
    description: null,
    enabled: 1,
    iconUrl: null,
    id: "01J00000000000000000000005" as McpServerId,
    name: "MCP",
    oauthMetadataJson,
    ownerId: "01J00000000000000000000003" as AccountId,
    ownerName: "Owner",
    projectId: "01J00000000000000000000002" as ProjectId,
    source: "app",
    updatedAt: 1,
    url: "https://mcp.example.com",
  };
}

function database(): SqliteD1Database {
  const db = new SqliteD1Database();
  db.execute(`CREATE TABLE mcp_server (id TEXT PRIMARY KEY, oauth_metadata_json TEXT, updated_at INTEGER);
    INSERT INTO mcp_server VALUES ('01J00000000000000000000005', NULL, 1);`);
  return db;
}

const credentials = {
  clientId: "test-client",
  clientSecret: "fake-client-secret",
  code: "fake-code",
  codeVerifier: "fake-verifier",
  redirectUri: "https://mosoo.example.com/callback",
};

// Given an insecure endpoint, when exchanging either grant, then no credentials leave the process.
describe("MCP OAuth HTTPS transport", () => {
  test("sends no credentials to a reachable HTTP receiver", async () => {
    let credentialRequests = 0;
    const receiver = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname !== "/health") {
          credentialRequests++;
        }
        return Response.json({ access_token: "fake-access", client_id: "test-client" });
      },
    });
    try {
      expect((await fetch(new URL("/health", receiver.url))).ok).toBe(true);
      const endpoint = new URL("/credentials", receiver.url).toString();
      for (const refreshToken of [undefined, "fake-refresh-token"]) {
        await expect(
          exchangeOAuthToken({ ...credentials, refreshToken, tokenEndpoint: endpoint }),
        ).rejects.toThrow("OAuth endpoints must use HTTPS");
      }
      await expect(
        registerDynamicOAuthClient(
          { ...metadata, registration_endpoint: endpoint },
          credentials.redirectUri,
        ),
      ).rejects.toThrow("OAuth endpoints must use HTTPS");
      expect(credentialRequests).toBe(0);
    } finally {
      receiver.stop(true);
    }
  });

  for (const endpoint of [
    "http://oauth.example.com/token",
    "http://127.0.0.1/token",
    "ftp://oauth.example.com/token",
    "/token",
    "https://user:password@oauth.example.com/token",
    "https://oauth.example.com/token#fragment",
  ]) {
    for (const refreshToken of [undefined, "fake-refresh-token"]) {
      test(`rejects token endpoint ${endpoint} for ${refreshToken ? "refresh" : "authorization code"}`, async () => {
        const fetchMock = mock(async () => Response.json({ access_token: "fake-access" }));
        globalThis.fetch = fetchMock as typeof fetch;
        await expect(
          exchangeOAuthToken({ ...credentials, refreshToken, tokenEndpoint: endpoint }),
        ).rejects.toThrow("OAuth endpoints must use HTTPS");
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }
  }

  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
  ] as const) {
    test(`rejects cached HTTP ${field} before discovery or authorization`, async () => {
      const fetchMock = mock(async () => Response.json(metadata));
      globalThis.fetch = fetchMock as typeof fetch;
      await expect(
        getOrDiscoverOAuthMetadata(
          database(),
          server(JSON.stringify({ ...metadata, [field]: "http://oauth.example.com/insecure" })),
        ),
      ).rejects.toThrow("OAuth endpoints must use HTTPS");
      expect(fetchMock).not.toHaveBeenCalled();
    });
    test(`does not persist discovered HTTP ${field}`, async () => {
      const db = database();
      globalThis.fetch = mock(async () =>
        Response.json({ ...metadata, [field]: "http://oauth.example.com/insecure" }),
      ) as typeof fetch;
      await expect(getOrDiscoverOAuthMetadata(db, server(null))).rejects.toThrow(
        "OAuth endpoints must use HTTPS",
      );
      expect(
        await db.prepare("SELECT oauth_metadata_json FROM mcp_server").first("oauth_metadata_json"),
      ).toBeNull();
    });
  }

  test("rejects HTTP dynamic registration without a request", async () => {
    const fetchMock = mock(async () => Response.json({ client_id: "test-client" }));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(
      registerDynamicOAuthClient(
        { ...metadata, registration_endpoint: "http://oauth.example.com/register" },
        credentials.redirectUri,
      ),
    ).rejects.toThrow("OAuth endpoints must use HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Given HTTPS redirect responses, when requesting OAuth resources, then never follow Location.
  for (const status of [301, 302, 303, 307, 308]) {
    test(`does not follow ${status} token, registration or discovery redirects`, async () => {
      const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status,
          headers: { location: "http://oauth.example.com/trap" },
        });
      });
      globalThis.fetch = fetchMock as typeof fetch;
      await expect(
        exchangeOAuthToken({ ...credentials, tokenEndpoint: metadata.token_endpoint }),
      ).rejects.toThrow("OAuth token exchange failed");
      await expect(registerDynamicOAuthClient(metadata, credentials.redirectUri)).rejects.toThrow(
        "OAuth dynamic registration failed",
      );
      await expect(getOrDiscoverOAuthMetadata(database(), server(null))).rejects.toThrow(
        "OAuth discovery failed",
      );
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  }

  test("preserves HTTPS authorization-code and refresh grant bodies", async () => {
    const bodies: URLSearchParams[] = [];
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      if (!(init?.body instanceof URLSearchParams)) {
        throw new TypeError("Expected a form-encoded OAuth request body.");
      }
      bodies.push(init.body);
      return Response.json({
        access_token: "fake-access",
        refresh_token: "fake-rotated",
        expires_in: 3600,
      });
    }) as typeof fetch;
    await expect(
      exchangeOAuthToken({ ...credentials, tokenEndpoint: metadata.token_endpoint }),
    ).resolves.toMatchObject({ access_token: "fake-access" });
    await exchangeOAuthToken({
      ...credentials,
      refreshToken: "fake-refresh-token",
      tokenEndpoint: metadata.token_endpoint,
    });
    expect(Object.fromEntries(bodies[0])).toEqual({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code: credentials.code,
      code_verifier: credentials.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: credentials.redirectUri,
    });
    expect(Object.fromEntries(bodies[1])).toEqual({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
      refresh_token: "fake-refresh-token",
    });
  });

  test("preserves HTTPS metadata discovery, cache and registration", async () => {
    const db = database();
    globalThis.fetch = mock(async () => Response.json(metadata)) as typeof fetch;
    expect(await getOrDiscoverOAuthMetadata(db, server(null))).toEqual(metadata);
    const cached = await db
      .prepare("SELECT oauth_metadata_json FROM mcp_server")
      .first<string>("oauth_metadata_json");
    expect(await getOrDiscoverOAuthMetadata(db, server(cached))).toEqual(metadata);
    globalThis.fetch = mock(async () =>
      Response.json({ client_id: "test-client", client_secret: "fake-secret" }),
    ) as typeof fetch;
    expect(await registerDynamicOAuthClient(metadata, credentials.redirectUri)).toEqual({
      clientId: "test-client",
      clientSecret: "fake-secret",
    });
  });
});
