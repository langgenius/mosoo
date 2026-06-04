import type { Viewer } from "@mosoo/contracts/account";
import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

import { getBetterAuth } from "../../src/modules/auth/application/auth-session.service";
import { getViewerFromRequest } from "../../src/modules/auth/application/viewer-auth.service";
import type { AuthenticatedViewer } from "../../src/modules/auth/application/viewer-auth.service";
import { getViewer } from "../../src/modules/users/application/viewer-context.service";
import type { ApiBindings } from "../../src/platform/cloudflare/worker-types";
import { createPublicHttpTestBindings } from "./published-agent-http-test-fixture";
import { SqliteD1Database } from "./sqlite-d1";

const AGENT_BUILDER_TEST_VIEWER = {
  email: "xiaoke@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000051",
  imageUrl: null,
  name: "Xiaoke",
} satisfies AuthenticatedViewer;

export const AGENT_BUILDER_TEST_IDS = {
  agentId: "01J00000000000000000000053",
  organizationId: "01J00000000000000000000052",
} as const;

export interface AgentBuilderApiFixture {
  readonly bindings: ApiBindings;
  readonly client: AgentBuilderApiTestClient;
  readonly database: SqliteD1Database;
  readonly ids: typeof AGENT_BUILDER_TEST_IDS;
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

class AgentBuilderApiCookieJar {
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

export class AgentBuilderApiTestClient {
  readonly #bindings: ApiBindings;
  readonly #cookieJar = new AgentBuilderApiCookieJar();

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

  async loginAsMosooAiTestAccount(
    email = AGENT_BUILDER_TEST_VIEWER.email,
  ): Promise<MosooAiBackdoorResponse> {
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
      throw new Error(`Unsupported Agent Builder API fixture path: ${path}`);
    }

    const response = await getBetterAuth(this.#bindings).handler(request);

    this.#cookieJar.store(response);
    return response;
  }
}

export async function createAgentBuilderApiFixture(): Promise<AgentBuilderApiFixture> {
  const database = new SqliteD1Database({ foreignKeys: false });

  createAgentBuilderApiSchema(database);
  await seedAgentBuilderApiFixture(database);

  const bindings = {
    ...createPublicHttpTestBindings(database),
    WEB_ORIGIN: TEST_ORIGIN,
  } as ApiBindings;

  return {
    bindings,
    client: new AgentBuilderApiTestClient(bindings),
    database,
    ids: AGENT_BUILDER_TEST_IDS,
    viewer: AGENT_BUILDER_TEST_VIEWER,
  };
}

function createAgentBuilderApiSchema(database: SqliteD1Database): void {
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
      default_environment_id text,
      id text PRIMARY KEY NOT NULL,
      join_policy text NOT NULL,
      name text NOT NULL,
      primary_domain text,
      slug text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_member (
      account_id text NOT NULL,
      created_at integer NOT NULL,
      disabled_at integer,
      disabled_by_account_id text,
      joined_at integer NOT NULL,
      organization_id text NOT NULL,
      role text NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE agent (
      config_json text NOT NULL,
      created_at integer NOT NULL,
      description text,
      environment_id text,
      id text PRIMARY KEY NOT NULL,
      kind text DEFAULT 'pet' NOT NULL,
      live_deployment_version_id text,
      model text NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
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
      organization_id text NOT NULL,
      owner_account_id text,
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
      organization_id text NOT NULL,
      packages_json text NOT NULL,
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
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
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
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL,
      version text
    );

    CREATE TABLE skill_preference (
      account_id text NOT NULL,
      auto_enabled integer NOT NULL,
      created_at integer NOT NULL,
      skill_id text NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (skill_id, account_id)
    );

    CREATE TABLE space (
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      updated_at integer NOT NULL,
      visibility text NOT NULL
    );

    CREATE TABLE space_directory (
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      parent_path text NOT NULL,
      path text NOT NULL,
      space_id text NOT NULL,
      updated_at integer NOT NULL
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
      scope_id text NOT NULL,
      scope_kind text NOT NULL,
      session_kind text,
      size integer NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL,
      version integer NOT NULL
    );

    CREATE TABLE agent_mcp_binding (
      agent_id text NOT NULL,
      server_id text NOT NULL
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
      refresh_secret_id text,
      scope text NOT NULL,
      scope_values_json text,
      secret_id text NOT NULL,
      server_id text NOT NULL,
      status text NOT NULL,
      subject_label text,
      updated_at integer NOT NULL
    );

    CREATE TABLE resource_acl (
      assigned_by_account_id text,
      created_at integer DEFAULT 1 NOT NULL,
      resource_id text NOT NULL,
      resource_type text NOT NULL,
      role text NOT NULL,
      target_id text NOT NULL,
      target_kind text NOT NULL
    );

    CREATE TABLE vendor_credential (
      api_base text,
      api_key_secret_id text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      is_default integer DEFAULT false NOT NULL,
      is_preferred integer DEFAULT false NOT NULL,
      models text,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text,
      updated_at integer NOT NULL,
      vendor_id text NOT NULL
    );

    CREATE TABLE agent_builder_thread (
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      creator_account_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      last_turn_at integer,
      message_seq_cursor integer DEFAULT 0 NOT NULL,
      organization_id text NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      title text,
      updated_at integer NOT NULL
    );
    CREATE UNIQUE INDEX agent_builder_thread_agent_idx ON agent_builder_thread (agent_id);

    CREATE TABLE agent_builder_message (
      cards_json text,
      content_text text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text,
      id text PRIMARY KEY NOT NULL,
      input_kind text,
      planner_run_id text,
      role text NOT NULL,
      seq integer NOT NULL,
      thread_id text NOT NULL
    );
    CREATE UNIQUE INDEX agent_builder_message_thread_seq_idx
      ON agent_builder_message (thread_id, seq);

    CREATE TABLE agent_builder_planner_run (
      agent_id text NOT NULL,
      completed_at integer,
      context_json text NOT NULL,
      created_at integer NOT NULL,
      error_code text,
      error_message text,
      id text PRIMARY KEY NOT NULL,
      model text NOT NULL,
      organization_id text NOT NULL,
      output_json text,
      provider text NOT NULL,
      request_digest text NOT NULL,
      status text NOT NULL,
      thread_id text NOT NULL,
      trace_id text NOT NULL,
      tool_trace_json text,
      trigger_message_id text
    );
  `);
}

async function seedAgentBuilderApiFixture(database: D1Database): Promise<void> {
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
      AGENT_BUILDER_TEST_VIEWER.email,
      1,
      AGENT_BUILDER_TEST_VIEWER.id,
      null,
      AGENT_BUILDER_TEST_IDS.organizationId,
      AGENT_BUILDER_TEST_VIEWER.name,
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
        join_policy,
        name,
        slug,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      AGENT_BUILDER_TEST_VIEWER.id,
      AGENT_BUILDER_TEST_IDS.organizationId,
      "invite_only",
      "Mosoo Agent Builder Test",
      "mosoo-agent-builder-test",
      1,
    )
    .run();

  await database
    .prepare(
      `INSERT INTO organization_member (
        account_id,
        created_at,
        joined_at,
        organization_id,
        role
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(AGENT_BUILDER_TEST_VIEWER.id, 1, 1, AGENT_BUILDER_TEST_IDS.organizationId, "owner")
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
        organization_id,
        owner_account_id,
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
        agentsFileId: null,
        packageMcpServers: [],
        packageResolution: null,
        packageSharingEnabled: false,
        packageSkills: [],
      }),
      1,
      "Draft fixture for Agent Builder API tests.",
      AGENT_BUILDER_TEST_IDS.agentId,
      "pet",
      "gpt-5.4",
      "Agent Builder Fixture",
      AGENT_BUILDER_TEST_IDS.organizationId,
      AGENT_BUILDER_TEST_VIEWER.id,
      "Help the user assemble an Agent starter pack.",
      "openai",
      "openai-runtime",
      "draft",
      1,
      "private",
    )
    .run();
}
