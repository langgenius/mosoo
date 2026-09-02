import type { Viewer } from "@mosoo/contracts/account";
import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import { getBetterAuth } from "../../src/modules/auth/application/auth-session.service";
import { getViewerFromRequest } from "../../src/modules/auth/application/viewer-auth.service";
import type { AuthenticatedViewer } from "../../src/modules/auth/application/viewer-auth.service";
import { getViewer } from "../../src/modules/users/application/viewer-context.service";
import { storeVendorCredentialSecret } from "../../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../../src/platform/cloudflare/worker-types";
import { applyDrizzleMigrations } from "./drizzle-migrations";
import { createPublicHttpTestBindings } from "./public-api-http-test-fixture";
import { SqliteD1Database } from "./sqlite-d1";

const API_TEST_VIEWER = {
  email: "api.fixture@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000051",
  imageUrl: null,
  name: "API Fixture User",
} satisfies AuthenticatedViewer;

export const API_TEST_IDS = {
  agentId: "01J00000000000000000000053",
  environmentId: "01J00000000000000000000055",
  environmentRevisionId: "01J00000000000000000000056",
  organizationId: "01J00000000000000000000052",
  projectId: "01J00000000000000000000054",
} as const;

export interface ApiTestFixture {
  readonly bindings: ApiBindings;
  readonly client: ApiTestClient;
  readonly database: SqliteD1Database;
  readonly ids: typeof API_TEST_IDS;
  readonly viewer: AuthenticatedViewer;
}

interface MosooAiBackdoorResponse {
  readonly token: string;
  readonly user: {
    readonly email: string;
    readonly emailVerified: boolean;
    readonly id: string;
    readonly image?: string | null;
    readonly name: string;
  };
}

const TEST_ORIGIN = "http://localhost:5173";

function splitSetCookieHeader(header: string): string[] {
  return header
    .split(/,(?=\s*[^;,]+=)/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function readCookiePair(setCookie: string): readonly [string, string] | null {
  const pair = setCookie.split(";")[0]?.trim();

  if (!pair) {
    return null;
  }

  const separatorIndex = pair.indexOf("=");

  if (separatorIndex <= 0) {
    return null;
  }

  return [pair.slice(0, separatorIndex), pair.slice(separatorIndex + 1)] as const;
}

class ApiCookieJar {
  readonly #cookies = new Map<string, string>();

  header(): string | null {
    if (this.#cookies.size === 0) {
      return null;
    }

    return [...this.#cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  store(response: Response): void {
    const setCookieHeader = response.headers.get("set-cookie");

    if (!setCookieHeader) {
      return;
    }

    for (const setCookie of splitSetCookieHeader(setCookieHeader)) {
      const pair = readCookiePair(setCookie);

      if (pair !== null) {
        this.#cookies.set(pair[0], pair[1]);
      }
    }
  }
}

export class ApiTestClient {
  readonly #bindings: ApiBindings;
  readonly #cookieJar = new ApiCookieJar();

  constructor(bindings: ApiBindings) {
    this.#bindings = bindings;
  }

  sessionHeaders(init?: HeadersInit): Headers {
    const headers = new Headers(init);
    const cookieHeader = this.#cookieJar.header();

    if (cookieHeader !== null) {
      headers.set("cookie", cookieHeader);
    }

    return headers;
  }

  async loginAsMosooAiTestAccount(email = API_TEST_VIEWER.email): Promise<MosooAiBackdoorResponse> {
    const response = await this.postJson(
      `${PUBLIC_API_PREFIX}/auth/development-backdoor/mosoo-ai-login`,
      {
        email,
      },
    );

    if (!response.ok) {
      throw new Error(`mosoo.ai test login failed with status ${response.status}.`);
    }

    return (await response.json()) as MosooAiBackdoorResponse;
  }

  async readAuthenticatedViewerFromSession(): Promise<AuthenticatedViewer | null> {
    const headers = new Headers();
    const cookieHeader = this.#cookieJar.header();

    if (cookieHeader !== null) {
      headers.set("cookie", cookieHeader);
    }

    return getViewerFromRequest(this.#bindings, new Request(TEST_ORIGIN, { headers }));
  }

  async readViewerContext(): Promise<Viewer> {
    return getViewer(
      this.#bindings.DB,
      this.#bindings,
      await this.readAuthenticatedViewerFromSession(),
    );
  }

  async postJson(path: string, body: Record<string, unknown>): Promise<Response> {
    return this.request(path, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookieHeader = this.#cookieJar.header();

    headers.set("origin", TEST_ORIGIN);

    if (cookieHeader !== null) {
      headers.set("cookie", cookieHeader);
    }

    const request = new Request(new URL(path, TEST_ORIGIN), {
      ...init,
      headers,
    });
    if (!path.startsWith(`${PUBLIC_API_PREFIX}/auth/`)) {
      throw new Error(`Unsupported API fixture path: ${path}`);
    }

    const response = await getBetterAuth(this.#bindings).handler(request);

    this.#cookieJar.store(response);
    return response;
  }
}

export async function createApiTestFixture(): Promise<ApiTestFixture> {
  const database = new SqliteD1Database();

  applyDrizzleMigrations(database);
  await seedApiTestFixture(database);

  const bindings = {
    ...createPublicHttpTestBindings(database),
    WEB_ORIGIN: TEST_ORIGIN,
  } as ApiBindings;

  return {
    bindings,
    client: new ApiTestClient(bindings),
    database,
    ids: API_TEST_IDS,
    viewer: API_TEST_VIEWER,
  };
}

export async function insertTestVendorCredential(
  fixture: ApiTestFixture,
  input: {
    readonly apiBase?: string | null;
    readonly apiKey?: string;
    readonly credentialId?: string;
    readonly models?: readonly string[] | null;
    readonly name?: string;
    readonly projectId?: string;
    readonly vendorId: string;
  },
): Promise<void> {
  const credentialId = input.credentialId ?? "01J000000000000000000000C1";
  const projectId = input.projectId ?? fixture.ids.projectId;
  const apiKeySecretId = await storeVendorCredentialSecret(fixture.bindings, {
    apiKey: input.apiKey ?? "sk-test",
    credentialId,
    projectId,
    providerId: input.vendorId,
    purpose: "credential_create_api_key",
  });

  await fixture.bindings.DB.prepare(
    `INSERT INTO vendor_credential (
      api_base,
      api_key_secret_id,
      created_at,
      id,
      models,
      name,
      project_id,
      updated_at,
      vendor_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.apiBase ?? null,
      apiKeySecretId,
      1,
      credentialId,
      input.models === undefined || input.models === null ? null : JSON.stringify(input.models),
      input.name ?? `${input.vendorId} test`,
      projectId,
      1,
      input.vendorId,
    )
    .run();
}

async function seedApiTestFixture(database: D1Database): Promise<void> {
  await database
    .prepare(
      `INSERT INTO account (
        created_at,
        email,
        email_verified,
        id,
        image_url,
        last_active_organization_id,
        name,
        system_agent_model,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      API_TEST_VIEWER.email,
      1,
      API_TEST_VIEWER.id,
      null,
      API_TEST_IDS.organizationId,
      API_TEST_VIEWER.name,
      JSON.stringify({ modelId: "gpt-5.4", vendor: "openai" }),
      1,
    )
    .run();

  await database
    .prepare(
      `INSERT INTO organization (
        created_at,
        creator_account_id,
        id,
        name,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(1, API_TEST_VIEWER.id, API_TEST_IDS.organizationId, "mosoo API Test", 1)
    .run();

  await database
    .prepare(
      `INSERT INTO project (
        created_at,
        id,
        name,
        organization_id,
        owner_account_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      API_TEST_IDS.projectId,
      "Default Project",
      API_TEST_IDS.organizationId,
      API_TEST_VIEWER.id,
      1,
    )
    .run();

  await database
    .prepare(
      `INSERT INTO environment (
        created_at,
        current_revision_id,
        description,
        forked_from_environment_id,
        forked_from_environment_name,
        forked_from_owner_name,
        id,
        name,
        owner_account_id,
        project_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      API_TEST_IDS.environmentRevisionId,
      "Reusable API test environment.",
      null,
      null,
      null,
      API_TEST_IDS.environmentId,
      "API Test Environment",
      API_TEST_VIEWER.id,
      API_TEST_IDS.projectId,
      1,
    )
    .run();

  await database
    .prepare(
      `INSERT INTO environment_revision (
        allow_mcp_servers,
        allow_package_managers,
        allowed_hosts_json,
        created_at,
        created_by_account_id,
        env_vars_json,
        environment_id,
        id,
        network_policy,
        packages_json,
        project_id,
        setup_script
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      1,
      "[]",
      1,
      API_TEST_VIEWER.id,
      "[]",
      API_TEST_IDS.environmentId,
      API_TEST_IDS.environmentRevisionId,
      "full",
      "[]",
      API_TEST_IDS.projectId,
      "",
    )
    .run();

  await database
    .prepare(
      `INSERT INTO agent (
        config_json,
        created_at,
        description,
        id,
        kind,
        model,
        name,
        owner_account_id,
        project_id,
        prompt,
        provider,
        runtime_id,
        status,
        updated_at,
        visibility
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      JSON.stringify({
        packageMcpServers: [],
        packageResolution: null,
        packageSkills: [],
        providerOptions: {},
      }),
      1,
      "Draft fixture for API tests.",
      API_TEST_IDS.agentId,
      "pet",
      "gpt-5.4",
      "API Fixture Agent",
      API_TEST_VIEWER.id,
      API_TEST_IDS.projectId,
      "Help the user test API behavior.",
      "openai",
      "openai-runtime",
      "draft",
      1,
      "private",
    )
    .run();
}
