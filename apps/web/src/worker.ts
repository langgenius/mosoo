import { MOSOO_CONSOLE_HOST, MOSOO_LEGACY_CONSOLE_HOST } from "@mosoo/contracts/origin";

// Locally typed so the SPA build does not pull in `@cloudflare/workers-types`:
// the API service binding and Workers Assets only expose `fetch` at runtime.
interface FetchBinding {
  readonly fetch: (request: Request) => Promise<Response>;
}
export interface Env {
  readonly API: FetchBinding;
  readonly ASSETS: FetchBinding;
}

// Agent-auth discovery for the Public Thread API, read by clients that follow
// https://mosoo.ai/auth.md. There is no OAuth exchange: the account owner
// creates a Project API key (`msp_`) on the API keys page and hands it to the
// agent, and the key reaches only its own Project.
const PROJECT_API_KEY_SCOPE = "project";
const PROJECT_API_KEY_CREDENTIAL_TYPE = "mosoo_project_api_key";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === MOSOO_LEGACY_CONSOLE_HOST) {
      url.hostname = MOSOO_CONSOLE_HOST;
      return Response.redirect(url.toString(), 308);
    }

    if (
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-authorization-server"
    ) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          headers: { allow: "GET, HEAD" },
          status: 405,
        });
      }

      const apiKeysUri = `${url.origin}/project-settings/api-keys`;
      const metadata =
        url.pathname === "/.well-known/oauth-protected-resource"
          ? {
              authorization_servers: [url.origin],
              bearer_methods_supported: ["header"],
              resource: url.origin,
              resource_documentation: "https://mosoo.ai/docs/api-reference/",
              resource_name: "mosoo Public Thread API",
              scopes_supported: [PROJECT_API_KEY_SCOPE],
            }
          : {
              agent_auth: {
                anonymous: {
                  claim_uri: apiKeysUri,
                  credential_types_supported: [PROJECT_API_KEY_CREDENTIAL_TYPE],
                },
                claim_uri: apiKeysUri,
                identity_types_supported: ["anonymous"],
                register_uri: apiKeysUri,
                revocation_uri: apiKeysUri,
                skill: "https://mosoo.ai/auth.md",
              },
              issuer: url.origin,
              scopes_supported: [PROJECT_API_KEY_SCOPE],
            };
      const body = JSON.stringify(metadata);

      return new Response(request.method === "HEAD" ? null : body, {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return env.API.fetch(request);
    }

    const assetRes = await env.ASSETS.fetch(request);

    // Asset binding found something — let the response through.
    if (assetRes.status !== 404) {
      return assetRes;
    }

    // SPA route — react-router decides what to render client-side, so we
    // intentionally return the index document with 200. Fetch "/" rather than
    // "/index.html": the assets binding's default html_handling
    // ("auto-trailing-slash") answers "/index.html" with a 307 to "/", and
    // passing that redirect through breaks every deep link.
    const indexRes = await env.ASSETS.fetch(new Request(new URL("/", url.origin).href, request));
    return indexRes;
  },
};
