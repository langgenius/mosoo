import { MOSOO_CONSOLE_ORIGIN } from "@mosoo/contracts/origin";
import { PUBLIC_API_PREFIX, PUBLIC_API_VERSION_PREFIX } from "@mosoo/contracts/public-api-core";

import { MOSOO_API_REFERENCE_URL } from "@/shared/config/external-links";

import type { Agent } from "../agent.types";

export interface AgentDistribution {
  apiBasePath: string;
  apiBaseUrl: string;
  apiDocsUrl: string;
  apiPath: string;
  apiUrl: string;
  openApiPath: string;
  openApiUrl: string;
  threadsPath: string;
  threadsUrl: string;
  tokenSettingsPath: string;
  webUrl: string;
}

const ACCESS_TOKEN_SETTINGS_PATH = "/settings/access-tokens";
const AGENT_API_ENDPOINT_BASE_PATH = `${PUBLIC_API_PREFIX}${PUBLIC_API_VERSION_PREFIX}`;
const AGENT_API_ENDPOINT_OPENAPI_PATH = `${AGENT_API_ENDPOINT_BASE_PATH}/openapi.json`;

function shortSlug(id: string): string {
  return (
    id
      .replaceAll(/[^a-z0-9]/gi, "")
      .slice(0, 6)
      .toLowerCase() || "agent"
  );
}

function nameSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "")
    .slice(0, 24);
  return slug || "agent";
}

function currentOrigin(): string {
  return globalThis.window !== undefined ? globalThis.location.origin : MOSOO_CONSOLE_ORIGIN;
}

/**
 * Distribution coordinates surfaced to the publisher. The web URL points at
 * the public chat shell; the API path is the access-gated Thread entry point.
 * Both are derived from the agent itself — the backend's authorization gate
 * is what actually decides who can use them.
 *
 * @param {Agent} agent Agent whose public web and API coordinates are being shown.
 * @returns {AgentDistribution} Fully resolved distribution URLs and paths for the agent.
 */
export function buildAgentDistribution(agent: Agent): AgentDistribution {
  const origin = currentOrigin();
  const slug = `${nameSlug(agent.name)}-${shortSlug(agent.id)}`;
  const webUrl = `${origin}/a/${slug}`;
  const threadsPath = `/threads?compose=1&agent=${encodeURIComponent(agent.id)}&lock=1`;
  const threadsUrl = `${origin}${threadsPath}`;
  const apiPath = `POST ${AGENT_API_ENDPOINT_BASE_PATH}/agents/${agent.id}/threads`;
  const apiUrl = `${origin}${AGENT_API_ENDPOINT_BASE_PATH}/agents/${agent.id}/threads`;

  return {
    apiBasePath: AGENT_API_ENDPOINT_BASE_PATH,
    apiBaseUrl: `${origin}${AGENT_API_ENDPOINT_BASE_PATH}`,
    apiDocsUrl: MOSOO_API_REFERENCE_URL,
    apiPath,
    apiUrl,
    openApiPath: AGENT_API_ENDPOINT_OPENAPI_PATH,
    openApiUrl: `${origin}${AGENT_API_ENDPOINT_OPENAPI_PATH}`,
    threadsPath,
    threadsUrl,
    tokenSettingsPath: ACCESS_TOKEN_SETTINGS_PATH,
    webUrl,
  };
}

/**
 * Curl example using an Access Token bearer. The placeholder
 * `$MOSOO_API_TOKEN` is meant to be replaced by a token from API Tokens settings.
 *
 * @param {Agent} agent Agent whose public API endpoints should be shown.
 * @returns {string} Copy-ready curl command for creating a thread.
 */
export function buildAgentApiCurl(agent: Agent): string {
  const { apiUrl } = buildAgentDistribution(agent);
  return buildCreateThreadCurl(apiUrl);
}

function buildCreateThreadCurl(url: string): string {
  return [
    `curl -X POST "${url}" \\`,
    `  -H "Authorization: Bearer $MOSOO_API_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Idempotency-Key: create-thread-$(date +%s)" \\`,
    `  -d '{"input":{"type":"user.message","content":[{"type":"text","text":"Say hello"}]},"client_external_ref":"demo-thread-001"}'`,
  ].join("\n");
}

/**
 * Name-addressed create-thread path for an agent exposed under its App's API
 * namespace, e.g. "POST /api/v1/apps/roadmap-board/agents/roadmap/threads".
 * Used only for exposed agents on a slugged App — never carries the agent ULID.
 *
 * @param {string} appSlug App API namespace slug.
 * @param {string} agentName URL-safe exposed agent name.
 * @returns {string} `POST` line for the name-addressed thread endpoint.
 */
export function buildAgentNamespacePath(appSlug: string, agentName: string): string {
  return `POST ${AGENT_API_ENDPOINT_BASE_PATH}/apps/${appSlug}/agents/${agentName}/threads`;
}

/**
 * Fully-qualified name-addressed create-thread URL for an exposed agent.
 *
 * @param {string} appSlug App API namespace slug.
 * @param {string} agentName URL-safe exposed agent name.
 * @returns {string} Absolute URL for the name-addressed thread endpoint.
 */
export function buildAgentNamespaceUrl(appSlug: string, agentName: string): string {
  return `${currentOrigin()}${AGENT_API_ENDPOINT_BASE_PATH}/apps/${appSlug}/agents/${agentName}/threads`;
}

/**
 * Name-addressed create-thread curl for an exposed agent. Mirrors
 * {@link buildAgentApiCurl} but addresses the agent by App slug + name, so the
 * agent ULID never appears.
 *
 * @param {string} appSlug App API namespace slug.
 * @param {string} agentName URL-safe exposed agent name.
 * @returns {string} Copy-ready curl command for creating a thread.
 */
export function buildAgentNamespaceCurl(appSlug: string, agentName: string): string {
  return buildCreateThreadCurl(buildAgentNamespaceUrl(appSlug, agentName));
}
