/**
 * Per-App OpenAPI document for the name-addressed API namespace (PRD "API
 * Namespace & Access"). The document is derived from the instance-global
 * document's `/agents/{agentId}/threads` operations so namespace semantics
 * can never drift from the ULID surface: the `agentId` path parameter is
 * stripped and each exposed Agent name is baked into its own path, served
 * under `servers = [{origin}/api/v1/apps/{slug}]`. Thread-level operations
 * stay ULID-addressed on the global document — create responses link
 * Threads at `/api/v1/threads/{threadId}`.
 *
 * Served unauthenticated (global-doc parity): exposed Agent names are
 * shareable surface by design, which trades away name secrecy for the App
 * the caller already knows the slug of.
 */
import { PUBLIC_API_PREFIX, PUBLIC_API_VERSION_PREFIX } from "@mosoo/contracts/public-api";

import { createPublicApiOpenApiDocument } from "./public-api-openapi";

type PublicApiOpenApiDocument = ReturnType<typeof createPublicApiOpenApiDocument>;
type PublicApiOperation = NonNullable<PublicApiOpenApiDocument["paths"][string]["get"]>;

const AGENT_THREADS_TEMPLATE_PATH = "/agents/{agentId}/threads";

export interface AppNamespaceOpenApiDocument {
  components: PublicApiOpenApiDocument["components"];
  info: {
    description: string;
    title: string;
    version: PublicApiOpenApiDocument["info"]["version"];
  };
  openapi: "3.1.0";
  paths: Record<string, { get: PublicApiOperation; post: PublicApiOperation }>;
  security: PublicApiOpenApiDocument["security"];
  servers: { url: string }[];
}

export function createAppNamespaceOpenApiDocument(input: {
  agentNames: readonly string[];
  appSlug: string;
  origin: string;
}): AppNamespaceOpenApiDocument {
  const base = createPublicApiOpenApiDocument(input.origin);
  const template = base.paths[AGENT_THREADS_TEMPLATE_PATH];
  const listOperation = template?.get;
  const createOperation = template?.post;

  if (listOperation === undefined || createOperation === undefined) {
    throw new Error("Public API OpenAPI document is missing the agent threads template path.");
  }

  const paths: AppNamespaceOpenApiDocument["paths"] = {};

  for (const agentName of input.agentNames) {
    paths[`/agents/${agentName}/threads`] = {
      get: withoutAgentIdParameter(listOperation),
      post: withoutAgentIdParameter(createOperation),
    };
  }

  return {
    components: base.components,
    info: {
      description:
        `Name-addressed Public Thread API namespace for the Mosoo App "${input.appSlug}". ` +
        "Exposed Agents are addressed by name under this App's base path and accept the same " +
        "requests as the instance-global /agents/{agentId}/threads routes. Thread-level " +
        `operations stay ULID-addressed at ${PUBLIC_API_PREFIX}${PUBLIC_API_VERSION_PREFIX}` +
        "/threads/{threadId}, which is where create responses link created Threads.",
      title: `Mosoo App API — ${input.appSlug}`,
      version: base.info.version,
    },
    openapi: "3.1.0",
    paths,
    security: base.security,
    servers: [
      {
        url: `${input.origin}${PUBLIC_API_PREFIX}${PUBLIC_API_VERSION_PREFIX}/apps/${input.appSlug}`,
      },
    ],
  };
}

/**
 * The namespace path carries the Agent name, so the template's `agentId`
 * path parameter disappears; everything else (request bodies, responses,
 * security, and the Idempotency-Key/archived parameters) is shared verbatim
 * with the ULID surface.
 */
function withoutAgentIdParameter(operation: PublicApiOperation): PublicApiOperation {
  return {
    ...operation,
    parameters: (operation.parameters ?? []).filter((parameter) => parameter.name !== "agentId"),
  };
}
