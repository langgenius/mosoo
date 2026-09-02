import { expect, test } from "bun:test";

import worker from "../src/worker";

test("serves agent authentication metadata before assets", async () => {
  const env = {
    ASSETS: {
      fetch: () => Promise.reject(new Error("metadata must not reach the asset fallback")),
    },
  };

  for (const origin of ["https://cloud.mosoo.ai", "https://resource.example:8443"]) {
    const response = await worker.fetch(
      new Request(`${origin}/.well-known/oauth-protected-resource`),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      resource: origin,
      resource_documentation: "https://mosoo.ai/docs/api-reference/",
      resource_name: "Mosoo Public Thread API",
      scopes_supported: ["full_account_access"],
    });

    const authorizationResponse = await worker.fetch(
      new Request(`${origin}/.well-known/oauth-authorization-server`),
      env,
    );

    expect(authorizationResponse.status).toBe(200);
    expect(await authorizationResponse.json()).toEqual({
      agent_auth: {
        anonymous: {
          claim_uri: `${origin}/settings/access-tokens`,
          credential_types_supported: ["mosoo_personal_access_token"],
        },
        claim_uri: `${origin}/settings/access-tokens`,
        identity_types_supported: ["anonymous"],
        register_uri: `${origin}/settings/access-tokens`,
        revocation_uri: `${origin}/settings/access-tokens`,
        skill: "https://mosoo.ai/auth.md",
      },
      issuer: origin,
      scopes_supported: ["full_account_access"],
    });
  }

  const headResponse = await worker.fetch(
    new Request("https://cloud.mosoo.ai/.well-known/oauth-protected-resource", {
      method: "HEAD",
    }),
    env,
  );

  expect(headResponse.status).toBe(200);
  expect(headResponse.headers.get("content-type")).toBe("application/json");
  expect(await headResponse.text()).toBe("");

  const methodNotAllowed = await worker.fetch(
    new Request("https://cloud.mosoo.ai/.well-known/oauth-protected-resource", {
      method: "POST",
    }),
    env,
  );

  expect(methodNotAllowed.status).toBe(405);
  expect(methodNotAllowed.headers.get("allow")).toBe("GET, HEAD");
});

test("forwards unauthenticated API responses without falling back to assets", async () => {
  let fetchedAsset = false;
  let forwardedAuthorization: string | null | undefined;
  const response = await worker.fetch(
    new Request("https://cloud.mosoo.ai/api/v1/agents/01J00000000000000000000001/threads"),
    {
      API: {
        fetch: (request) => {
          forwardedAuthorization = request.headers.get("authorization");
          return Promise.resolve(
            Response.json(
              {
                error: {
                  code: "unauthenticated",
                  message: "A valid Access Token is required.",
                },
              },
              { status: 401 },
            ),
          );
        },
      },
      ASSETS: {
        fetch: () => {
          fetchedAsset = true;
          return Promise.resolve(new Response(null, { status: 404 }));
        },
      },
    },
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: {
      code: "unauthenticated",
      message: "A valid Access Token is required.",
    },
  });
  expect(forwardedAuthorization).toBeNull();
  expect(fetchedAsset).toBe(false);
});

test("redirects the legacy console host without losing the path or query", async () => {
  let fetchedAsset = false;
  const response = await worker.fetch(
    new Request("http://try.mosoo.ai/projects/demo?source=bookmark"),
    {
      ASSETS: {
        fetch: () => {
          fetchedAsset = true;
          return Promise.resolve(new Response(null, { status: 404 }));
        },
      },
    },
  );

  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(
    "https://cloud.mosoo.ai/projects/demo?source=bookmark",
  );
  expect(fetchedAsset).toBe(false);
});

test("redirects plaintext requests for the canonical console host", async () => {
  const response = await worker.fetch(new Request("http://cloud.mosoo.ai/settings?tab=profile"), {
    ASSETS: {
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
    },
  });

  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe("https://cloud.mosoo.ai/settings?tab=profile");
});
