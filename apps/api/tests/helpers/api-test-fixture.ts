import type { Viewer } from "@mosoo/contracts/account";
import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import { getBetterAuth } from "../../src/modules/auth/application/auth-session.service";
import { getViewerFromRequest } from "../../src/modules/auth/application/viewer-auth.service";
import type { AuthenticatedViewer } from "../../src/modules/auth/application/viewer-auth.service";
import { getViewer } from "../../src/modules/users/application/viewer-context.service";
import { storeVendorCredentialSecret } from "../../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import type { ApiBindings } from "../../src/platform/cloudflare/worker-types";
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
  appId: "01J00000000000000000000054",
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
      throw new Error(`Mosoo.ai test login failed with status ${response.status}.`);
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
  const database = new SqliteD1Database({ foreignKeys: false });

  createApiTestSchema(database);
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
    readonly appId?: string;
    readonly vendorId: string;
  },
): Promise<void> {
  const credentialId = input.credentialId ?? "01J000000000000000000000C1";
  const appId = input.appId ?? fixture.ids.appId;
  const apiKeySecretId = await storeVendorCredentialSecret(fixture.bindings, {
    apiKey: input.apiKey ?? "sk-test",
    credentialId,
    appId,
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
      app_id,
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
      appId,
      1,
      input.vendorId,
    )
    .run();
}

function createApiTestSchema(database: SqliteD1Database): void {
  database.execute(`
    CREATE TABLE account (
      created_at integer NOT NULL,
      email text NOT NULL,
      email_verified integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      image_url text,
      last_active_organization_id text,
      name text NOT NULL,
      system_agent_model text,
      updated_at integer NOT NULL
    );
    CREATE UNIQUE INDEX account_email_idx ON account (email);

    CREATE TABLE auth_account (
      access_token text,
      access_token_expires_at integer,
      provider_account_id text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      id_token text,
      password text,
      provider_id text NOT NULL,
      refresh_token text,
      refresh_token_expires_at integer,
      scope text,
      updated_at integer NOT NULL,
      account_id text NOT NULL
    );

    CREATE TABLE auth_session (
      created_at integer NOT NULL,
      expires_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      ip_address text,
      token text NOT NULL,
      updated_at integer NOT NULL,
      user_agent text,
      account_id text NOT NULL
    );
    CREATE UNIQUE INDEX auth_session_token_idx ON auth_session (token);

    CREATE TABLE auth_verification (
      created_at integer NOT NULL,
      expires_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      identifier text NOT NULL,
      updated_at integer NOT NULL,
      value text NOT NULL
    );

    CREATE TABLE organization (
      avatar_url text,
      created_at integer NOT NULL,
      creator_account_id text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE app (
      created_at integer NOT NULL,
      default_environment_id text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      slug text,
      updated_at integer NOT NULL
    );
    CREATE UNIQUE INDEX app_slug_idx ON app (slug) WHERE slug IS NOT NULL;

    CREATE TABLE app_deployment (
      app_id text NOT NULL,
      created_at integer NOT NULL,
      default_branch text NOT NULL,
      deleted_at integer,
      id text PRIMARY KEY NOT NULL,
      last_successful_url text,
      latest_run_id text,
      mosoo_subdomain text NOT NULL,
      owner_account_id text NOT NULL,
      repo_name text NOT NULL,
      repo_owner text NOT NULL,
      repo_url text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE app_deployment_run (
      app_id text NOT NULL,
      created_at integer NOT NULL,
      deployment_id text NOT NULL,
      error_code text,
      error_message text,
      external_deployment_id text,
      external_project_id text,
      external_version_id text,
      generated_wrangler_config_json text,
      id text PRIMARY KEY NOT NULL,
      mosoo_config_json text,
      native_result_json text,
      plan_json text,
      source_branch text NOT NULL,
      source_commit_sha text NOT NULL,
      status text NOT NULL,
      target_kind text,
      target_project_name text,
      target_script_name text,
      updated_at integer NOT NULL,
      url text
    );

    CREATE TABLE api_command (
      attempt_count integer DEFAULT 0 NOT NULL,
      claim_expires_at integer,
      claim_owner text,
      completed_at integer,
      created_at integer NOT NULL,
      dedupe_key text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      last_error_code text,
      last_error_message text,
      payload_json text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE UNIQUE INDEX api_command_dedupe_idx ON api_command (dedupe_key);

    CREATE TABLE agent (
      config_json text NOT NULL,
      created_at integer NOT NULL,
      description text,
      environment_id text,
      exposed_via_api integer,
      id text PRIMARY KEY NOT NULL,
      kind text DEFAULT 'pet' NOT NULL,
      live_deployment_version_id text,
      model text NOT NULL,
      name text NOT NULL,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      updated_at integer NOT NULL,
      visibility text DEFAULT 'private' NOT NULL
    );

    CREATE TABLE environment (
      created_at integer NOT NULL,
      current_revision_id text NOT NULL,
      description text NOT NULL,
      forked_from_environment_id text,
      forked_from_environment_name text,
      forked_from_owner_name text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      owner_account_id text,
      app_id text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE environment_revision (
      allow_mcp_servers integer NOT NULL,
      allow_package_managers integer NOT NULL,
      allowed_hosts_json text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text,
      env_vars_json text NOT NULL,
      environment_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      network_policy text NOT NULL,
      packages_json text NOT NULL,
      app_id text NOT NULL,
      setup_script text NOT NULL
    );

    CREATE TABLE mcp_server (
      auth_type text NOT NULL,
      byo_client_id text,
      byo_client_secret_secret_id text,
      created_at integer NOT NULL,
      credential_scope text NOT NULL,
      description text,
      enabled integer DEFAULT true NOT NULL,
      icon_url text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      oauth_metadata_json text,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      source text NOT NULL,
      updated_at integer NOT NULL,
      url text NOT NULL
    );

    CREATE TABLE skill (
      author text NOT NULL,
      created_at integer NOT NULL,
      current_snapshot_id text NOT NULL,
      description text NOT NULL,
      forked_from_owner_name text,
      forked_from_skill_id text,
      forked_from_skill_name text,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL,
      version text
    );

    CREATE TABLE file_record (
      committed integer NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      etag text,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      mime_type text,
      name text NOT NULL,
      object_key text NOT NULL,
      owner_id text NOT NULL,
      owner_kind text NOT NULL,
      parent_path text NOT NULL,
      path text NOT NULL,
      purpose text NOT NULL,
      scope_id text,
      scope_kind text NOT NULL,
      session_kind text,
      size integer NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL,
      version integer NOT NULL
    );

    CREATE TABLE file_upload (
      content_type text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      expected_size integer NOT NULL,
      expires_at integer NOT NULL,
      file_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      if_match_etag text,
      multipart_upload_id text,
      overwrite integer NOT NULL,
      part_size integer,
      scope_id text,
      scope_kind text NOT NULL,
      status text NOT NULL,
      strategy text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE agent_deployment_version (
      agent_id text NOT NULL,
      config_json text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      environment_id text,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      mcp_bindings_json text NOT NULL,
      model text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      skills_json text NOT NULL,
      summary text NOT NULL,
      version_number integer NOT NULL
    );

    CREATE TABLE agent_skill (
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      skill_id text NOT NULL,
      sort_order integer NOT NULL,
      PRIMARY KEY (agent_id, skill_id)
    );

    CREATE TABLE session (
      agent_id text NOT NULL,
      archived_at integer,
      attributed_user_id text,
      created_at integer NOT NULL,
      creator_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      last_message_at integer,
      last_run_id text,
      message_seq_cursor integer DEFAULT 0 NOT NULL,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      app_id text NOT NULL,
      provider text NOT NULL,
      renamed integer NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      runtime_event_seq_cursor integer DEFAULT 0 NOT NULL,
      title text,
      type text DEFAULT 'preview' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_run (
      agent_id text NOT NULL,
      completed_at integer,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      driver_instance_id text,
      error_code text,
      error_details_json text,
      error_message text,
      id text PRIMARY KEY NOT NULL,
      model text,
      provider text,
      runtime_id text,
      session_id text NOT NULL,
      started_at integer,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'run.queue' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      trace_id text NOT NULL,
      trigger text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      cloudflare_session_id text NOT NULL,
      created_at integer NOT NULL,
      cwd text NOT NULL,
      origin_json text NOT NULL,
      sandbox_id text NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_backup (
      created_at integer NOT NULL,
      dir text NOT NULL,
      error_message text,
      id text PRIMARY KEY NOT NULL,
      keep integer DEFAULT 0 NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL,
      ttl_seconds integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE driver_instance (
      boot_token_expires_at integer NOT NULL,
      boot_token_hash blob NOT NULL,
      boot_token_used_at integer,
      close_code integer,
      close_reason text,
      connection_id text,
      created_at integer NOT NULL,
      command_seq_cursor integer DEFAULT 0 NOT NULL,
      driver_pid integer,
      driver_started_at integer,
      driver_version text,
      error_message text,
      expires_at integer NOT NULL,
      heartbeat_count integer NOT NULL,
      generation integer DEFAULT 0 NOT NULL,
      id text PRIMARY KEY NOT NULL,
      last_heartbeat_at integer,
      process_id text,
      protocol text NOT NULL,
      protocol_version integer NOT NULL,
      restart_count integer DEFAULT 0 NOT NULL,
      runtime text NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'driver.provision' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE agent_mcp_binding (
      agent_credential_id text,
      agent_id text NOT NULL,
      created_at integer DEFAULT 1 NOT NULL,
      credential_mode text DEFAULT 'runtime_resolved' NOT NULL,
      enabled integer DEFAULT 1 NOT NULL,
      id text PRIMARY KEY DEFAULT '01J00000000000000000000999' NOT NULL,
      server_id text NOT NULL,
      sort_order integer DEFAULT 0 NOT NULL,
      updated_at integer DEFAULT 1 NOT NULL
    );

    CREATE TABLE mcp_credential (
      account_id text,
      agent_id text,
      auth_type text NOT NULL,
      created_at integer NOT NULL,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      last_refreshed_at integer,
      oauth_client_id text,
      oauth_client_secret_secret_id text,
      app_id text NOT NULL,
      refresh_secret_id text,
      scope text NOT NULL,
      scope_values_json text,
      secret_id text NOT NULL,
      server_id text NOT NULL,
      status text NOT NULL,
      subject_label text,
      updated_at integer NOT NULL
    );

    CREATE TABLE vendor_credential (
      api_base text,
      api_key_secret_id text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      is_default integer DEFAULT false NOT NULL,
      models text,
      name text NOT NULL,
      app_id text NOT NULL,
      updated_at integer NOT NULL,
      vendor_id text NOT NULL
    );

    CREATE TABLE vault_secret (
      algorithm text NOT NULL DEFAULT 'AES-GCM',
      ciphertext text NOT NULL,
      ciphertext_iv text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      updated_at integer NOT NULL,
      wrapped_dek text NOT NULL,
      wrapped_dek_iv text NOT NULL
    );
  `);
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
    .bind(1, API_TEST_VIEWER.id, API_TEST_IDS.organizationId, "Mosoo API Test", 1)
    .run();

  await database
    .prepare(
      `INSERT INTO app (
        created_at,
        id,
        name,
        organization_id,
        owner_account_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(1, API_TEST_IDS.appId, "Default App", API_TEST_IDS.organizationId, API_TEST_VIEWER.id, 1)
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
        app_id,
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
      API_TEST_IDS.appId,
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
        app_id,
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
      "sandbox",
      "[]",
      API_TEST_IDS.appId,
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
        app_id,
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
      API_TEST_IDS.appId,
      "Help the user test API behavior.",
      "openai",
      "openai-runtime",
      "draft",
      1,
      "private",
    )
    .run();
}
