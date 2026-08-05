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

type Translate = (key: string, variables?: Record<string, string>) => string;

const ACCESS_TOKEN_SETTINGS_PATH = "/settings/access-tokens";
const AGENT_API_ENDPOINT_BASE_PATH = `${PUBLIC_API_PREFIX}${PUBLIC_API_VERSION_PREFIX}`;
const AGENT_API_ENDPOINT_OPENAPI_PATH = `${AGENT_API_ENDPOINT_BASE_PATH}/openapi.json`;

const DEFAULT_INSTRUCTION_COPY: Record<string, string> = {
  "agentLifecycle.instructionAgentHeading": "## Agent",
  "agentLifecycle.instructionCreateThreadExample": "## Create-thread example",
  "agentLifecycle.instructionForLlmHeading": "# Instruction for LLM: {{agentName}}",
  "agentLifecycle.instructionGeneratedVariables": "## Generated variables",
  "agentLifecycle.instructionIntro":
    "Use this `.md` instruction with a coding agent that needs to control or use this mosoo agent programmatically.",
  "agentLifecycle.instructionProgrammaticControl": "## Programmatic control",
  "agentLifecycle.instructionStep1":
    "Create a mosoo API token in the console if one is not already available.",
  "agentLifecycle.instructionStep2": "Store it locally as `MOSOO_API_TOKEN`.",
  "agentLifecycle.instructionStep3":
    "Create a thread by sending a user message to `MOSOO_CREATE_THREAD_URL` with a bearer token.",
  "agentLifecycle.instructionStep4":
    "Persist the returned thread and run identifiers so follow-up calls can continue the same work.",
  "agentLifecycle.instructionStep5":
    "Use the API docs and OpenAPI document above for the exact response schema and continuation endpoints.",
  "agentLifecycle.instructionThreadResponse":
    "The create-thread response returns `thread/run`; continue the conversation through the Thread API when the task needs more turns.",
  "agentLifecycle.instructionTokenRead":
    "Read `MOSOO_API_TOKEN` from the environment. Do not hard-code or print the token.",
  "agentLifecycle.kindHintAssistant":
    "Conversational chat agent designed for back-and-forth dialogue.",
  "agentLifecycle.kindHintTask":
    "Job-style agent designed for one-shot calls that return a structured result.",
  "agentLifecycle.noDescriptionProvided": "No description provided.",
};

function defaultTranslate(key: string, variables?: Record<string, string>): string {
  return Object.entries(variables ?? {}).reduce(
    (result, [name, replacement]) => result.replaceAll(`{{${name}}}`, replacement),
    DEFAULT_INSTRUCTION_COPY[key] ?? key,
  );
}

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
export function buildAgentApiCurl(
  agent: Agent,
  distribution: AgentDistribution = buildAgentDistribution(agent),
): string {
  const { apiUrl } = distribution;
  return [
    `curl -X POST "${apiUrl}" \\`,
    `  -H "Authorization: Bearer $MOSOO_API_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Idempotency-Key: create-thread-$(date +%s)" \\`,
    `  -d '{"userId":"your-user-id","input":{"type":"user.message","content":[{"type":"text","text":"Say hello"}]}}'`,
  ].join("\n");
}

export function buildAgentInstructionPrompt(
  agent: Agent,
  distribution: AgentDistribution = buildAgentDistribution(agent),
  t: Translate = defaultTranslate,
): string {
  const description = agent.description.trim() || t("agentLifecycle.noDescriptionProvided");
  const kindHint =
    agent.kind === "pet"
      ? t("agentLifecycle.kindHintAssistant")
      : t("agentLifecycle.kindHintTask");

  return `${t("agentLifecycle.instructionForLlmHeading", { agentName: agent.name })}

${t("agentLifecycle.instructionIntro")}

${t("agentLifecycle.instructionGeneratedVariables")}

\`\`\`text
MOSOO_AGENT_ID=${agent.id}
MOSOO_AGENT_NAME=${agent.name}
MOSOO_AGENT_KIND=${agent.kind}
MOSOO_CREATE_THREAD_URL=${distribution.apiUrl}
MOSOO_API_DOCS_URL=${distribution.apiDocsUrl}
MOSOO_OPENAPI_URL=${distribution.openApiUrl}
MOSOO_THREAD_URL=${distribution.threadsUrl}
\`\`\`

${t("agentLifecycle.instructionTokenRead")}

${t("agentLifecycle.instructionAgentHeading")}

${description}

> ${kindHint}

${t("agentLifecycle.instructionProgrammaticControl")}

1. ${t("agentLifecycle.instructionStep1")}
2. ${t("agentLifecycle.instructionStep2")}
3. ${t("agentLifecycle.instructionStep3")}
4. ${t("agentLifecycle.instructionStep4")}
5. ${t("agentLifecycle.instructionStep5")}

${t("agentLifecycle.instructionCreateThreadExample")}

\`\`\`bash
${buildAgentApiCurl(agent, distribution)}
\`\`\`

${t("agentLifecycle.instructionThreadResponse")}
`;
}
