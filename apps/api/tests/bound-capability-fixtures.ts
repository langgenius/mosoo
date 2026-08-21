import type { Hono } from "hono";

import { mintAppAgentCapabilityToken } from "../src/modules/public-api/app-agent-capability";
import type { AppAgentCapabilityClaims } from "../src/modules/public-api/app-agent-capability";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpTestBindings,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";
import { requestPublicApiWithBindings } from "./public-thread-api-fixtures";

export const BOUND_DEPLOYMENT_ID = "01J0000000000000000000000D";
export const BOUND_DEPLOYMENT_RUN_ID = "01J0000000000000000000000R";
export const BOUND_REPLACEMENT_DEPLOYMENT_RUN_ID = "01J0000000000000000000000S";
export const BOUND_OTHER_DEPLOYMENT_ID = "01J0000000000000000000000E";
export const BOUND_OTHER_DEPLOYMENT_RUN_ID = "01J0000000000000000000000T";

export const BOUND_BINDING = {
  env: "MOSOO_AGENT_URL",
  expose: "public_thread",
  name: "Public API Agent",
} as const;

export function boundCapabilityClaims(
  overrides: Partial<AppAgentCapabilityClaims> = {},
): AppAgentCapabilityClaims {
  return {
    agentId: PUBLIC_API_TEST_IDS.agent,
    appId: PUBLIC_API_TEST_IDS.app,
    binding: { ...BOUND_BINDING },
    deploymentId: BOUND_DEPLOYMENT_ID,
    deploymentRunId: BOUND_DEPLOYMENT_RUN_ID,
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

/**
 * The minimal Deployment authority tables the capability checks read. Mirrors
 * the production columns the authority service touches; the public HTTP core
 * schema does not include them.
 */
export function createBoundDeploymentAuthoritySchema(database: SqliteD1Database): void {
  database.execute(`
      CREATE TABLE app_deployment (
        app_id text NOT NULL,
        deleted_at integer,
        id text PRIMARY KEY NOT NULL
      );

      CREATE TABLE app_deployment_run (
        app_id text NOT NULL,
        deployment_id text NOT NULL,
        id text PRIMARY KEY NOT NULL,
        plan_json text,
        status text NOT NULL
      );

      CREATE INDEX app_deployment_run_deployment_id_idx
        ON app_deployment_run (deployment_id, id);
    `);
}

export async function insertBoundDeployment(
  database: SqliteD1Database,
  input: {
    agentBindings?: unknown[];
    deletedAt?: number | null;
    deploymentId?: string;
    deploymentRunId?: string;
  } = {},
): Promise<void> {
  const deploymentId = input.deploymentId ?? BOUND_DEPLOYMENT_ID;

  await database
    .prepare("INSERT INTO app_deployment (app_id, deleted_at, id) VALUES (?, ?, ?)")
    .bind(PUBLIC_API_TEST_IDS.app, input.deletedAt ?? null, deploymentId)
    .run();
  await insertBoundDeploymentRun(database, {
    agentBindings: input.agentBindings ?? [BOUND_BINDING],
    deploymentId,
    deploymentRunId: input.deploymentRunId ?? BOUND_DEPLOYMENT_RUN_ID,
  });
}

export async function insertBoundDeploymentRun(
  database: SqliteD1Database,
  input: {
    agentBindings: unknown[];
    deploymentId: string;
    deploymentRunId: string;
    status?: string;
  },
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO app_deployment_run (app_id, deployment_id, id, plan_json, status) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      PUBLIC_API_TEST_IDS.app,
      input.deploymentId,
      input.deploymentRunId,
      JSON.stringify({ agentBindings: input.agentBindings }),
      input.status ?? "success",
    )
    .run();
}

export async function deleteBoundDeployment(
  database: SqliteD1Database,
  deploymentId = BOUND_DEPLOYMENT_ID,
): Promise<void> {
  await database
    .prepare("UPDATE app_deployment SET deleted_at = ? WHERE id = ?")
    .bind(Date.now(), deploymentId)
    .run();
}

export async function mintBoundCapabilityToken(
  bindings: ApiBindings,
  claims: AppAgentCapabilityClaims = boundCapabilityClaims(),
): Promise<string> {
  return mintAppAgentCapabilityToken(bindings.RUNTIME_ACTION_TOKEN_SECRET, claims);
}

export function boundCapabilityUrl(token: string, path = ""): string {
  return `https://api.example.com/api/v1/bound/${token}${path}`;
}

export interface BoundCapabilityClient {
  bindings: ApiBindings;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  token: string;
}

export async function createBoundCapabilityClient(input: {
  app: Hono;
  bindings: ApiBindings;
  claims?: AppAgentCapabilityClaims;
}): Promise<BoundCapabilityClient> {
  const token = await mintBoundCapabilityToken(input.bindings, input.claims);

  return {
    bindings: input.bindings,
    request: (path, init) =>
      requestPublicApiWithBindings(
        input.app,
        new Request(boundCapabilityUrl(token, path), init),
        input.bindings,
      ),
    token,
  };
}

export function createBoundTestBindings(
  database: SqliteD1Database,
  options: Parameters<typeof createPublicHttpTestBindings>[1] = {},
): ApiBindings {
  return createPublicHttpTestBindings(database, options) as ApiBindings;
}
