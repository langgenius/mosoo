import { describe, expect, test } from "bun:test";

import {
  createWfpDeploymentClient,
  wfpDispatchNamespace,
} from "../src/modules/apps/application/app-deployment-wfp-client";
import type { WfpClientBindings } from "../src/modules/apps/application/app-deployment-wfp-client";

const BINDINGS: WfpClientBindings = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "test-token",
};
const NAMESPACE = "test-namespace";
const SCRIPTS_URL =
  "https://api.cloudflare.com/client/v4/accounts/test-account/workers/dispatch/namespaces/test-namespace/scripts";
const ASSETS_UPLOAD_URL =
  "https://api.cloudflare.com/client/v4/accounts/test-account/workers/assets/upload?base64=true";

// base64("hello"); sha-256("hello") is
// 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.
const HELLO_BASE64 = "aGVsbG8=";
const HELLO_HASH = "2cf24dba5fb0a30e26e83b2ac5b9e29e";

interface RecordedFetchCall {
  init: RequestInit;
  url: string;
}

function createRecordingFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): { calls: RecordedFetchCall[]; fetchImpl: typeof fetch } {
  const calls: RecordedFetchCall[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;

    calls.push({ init: init ?? {}, url });

    return handler(url, init ?? {});
  }) as typeof fetch;

  return { calls, fetchImpl };
}

function requestHeader(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

function requestFormData(init: RequestInit): FormData {
  if (!(init.body instanceof FormData)) {
    throw new Error("Expected a FormData request body.");
  }

  return init.body;
}

function parseMetadata(form: FormData): Record<string, unknown> {
  const metadata = form.get("metadata");

  if (typeof metadata !== "string") {
    throw new Error("Expected a metadata form field.");
  }

  return JSON.parse(metadata) as Record<string, unknown>;
}

describe("wfp dispatch namespace resolution", () => {
  test("treats unset and blank namespaces as disabled", () => {
    expect(wfpDispatchNamespace({})).toBeNull();
    expect(wfpDispatchNamespace({ MOSOO_WFP_DISPATCH_NAMESPACE: "" })).toBeNull();
    expect(wfpDispatchNamespace({ MOSOO_WFP_DISPATCH_NAMESPACE: "   " })).toBeNull();
    expect(wfpDispatchNamespace({ MOSOO_WFP_DISPATCH_NAMESPACE: "mosoo-apps" })).toBe("mosoo-apps");
  });
});

describe("wfp deployment client", () => {
  test("deploys a worker module to the dispatch namespace", async () => {
    const { calls, fetchImpl } = createRecordingFetch(() =>
      Response.json({ result: { etag: "etag-1" } }),
    );
    const client = createWfpDeploymentClient(BINDINGS, NAMESPACE, { fetch: fetchImpl });

    const result = await client.deployNamespacedWorker({
      assets: null,
      compatibilityDate: "2026-06-26",
      mainModule: { content: "export default {};", name: "index.js" },
      scriptName: "app-x",
      vars: { AGENT_URL: "https://example.test/api/v1/bound/token" },
    });

    expect(result).toEqual({ etag: "etag-1" });
    expect(calls).toHaveLength(1);

    const call = calls[0];

    if (call === undefined) {
      throw new Error("Expected a recorded deploy request.");
    }

    expect(call.url).toBe(`${SCRIPTS_URL}/app-x`);
    expect(call.init.method).toBe("PUT");
    expect(requestHeader(call.init, "Authorization")).toBe("Bearer test-token");

    const form = requestFormData(call.init);
    const metadata = parseMetadata(form);

    expect(metadata).toEqual({
      bindings: [
        {
          name: "AGENT_URL",
          text: "https://example.test/api/v1/bound/token",
          type: "plain_text",
        },
      ],
      compatibility_date: "2026-06-26",
      main_module: "index.js",
    });

    const module = form.get("index.js");

    if (!(module instanceof Blob)) {
      throw new Error("Expected the worker module form part.");
    }

    expect(await module.text()).toBe("export default {};");
    expect(module.type).toBe("application/javascript+module");
  });

  test("uploads static assets through an upload session before deploying", async () => {
    const { calls, fetchImpl } = createRecordingFetch((url, init) => {
      if (url.endsWith("/assets-upload-session")) {
        return Response.json({
          result: { buckets: [[HELLO_HASH]], jwt: "session-jwt" },
        });
      }

      if (url === ASSETS_UPLOAD_URL) {
        expect(requestHeader(init, "Authorization")).toBe("Bearer session-jwt");

        return new Response(JSON.stringify({ result: { jwt: "completion-jwt" } }), {
          status: 201,
        });
      }

      return Response.json({ result: { etag: "etag-2" } });
    });
    const client = createWfpDeploymentClient(BINDINGS, NAMESPACE, { fetch: fetchImpl });

    const result = await client.deployNamespacedWorker({
      assets: {
        files: [{ contentBase64: HELLO_BASE64, path: "/index.html" }],
        notFoundHandling: "single-page-application",
      },
      compatibilityDate: "2026-06-26",
      mainModule: null,
      scriptName: "app-x",
      vars: {},
    });

    expect(result).toEqual({ etag: "etag-2" });
    expect(calls.map((call) => call.url)).toEqual([
      `${SCRIPTS_URL}/app-x/assets-upload-session`,
      ASSETS_UPLOAD_URL,
      `${SCRIPTS_URL}/app-x`,
    ]);

    const sessionCall = calls[0];
    const uploadCall = calls[1];
    const deployCall = calls[2];

    if (sessionCall === undefined || uploadCall === undefined || deployCall === undefined) {
      throw new Error("Expected session, upload, and deploy requests.");
    }

    if (typeof sessionCall.init.body !== "string") {
      throw new Error("Expected a JSON string session request body.");
    }

    expect(JSON.parse(sessionCall.init.body)).toEqual({
      manifest: { "/index.html": { hash: HELLO_HASH, size: 5 } },
    });

    const uploadPart = requestFormData(uploadCall.init).get(HELLO_HASH);

    if (!(uploadPart instanceof Blob)) {
      throw new Error("Expected the uploaded asset form part.");
    }

    expect(await uploadPart.text()).toBe(HELLO_BASE64);
    expect(uploadPart.type).toStartWith("text/html");

    const metadata = parseMetadata(requestFormData(deployCall.init));

    expect(metadata).toEqual({
      assets: {
        config: { not_found_handling: "single-page-application" },
        jwt: "completion-jwt",
      },
      compatibility_date: "2026-06-26",
    });
  });

  test("skips asset uploads when the session returns no buckets", async () => {
    const { calls, fetchImpl } = createRecordingFetch((url) => {
      if (url.endsWith("/assets-upload-session")) {
        return Response.json({ result: { buckets: [], jwt: "session-jwt" } });
      }

      return Response.json({ result: { etag: "etag-3" } });
    });
    const client = createWfpDeploymentClient(BINDINGS, NAMESPACE, { fetch: fetchImpl });

    await client.deployNamespacedWorker({
      assets: {
        files: [{ contentBase64: HELLO_BASE64, path: "/index.html" }],
        notFoundHandling: "none",
      },
      compatibilityDate: "2026-06-26",
      mainModule: null,
      scriptName: "app-x",
      vars: {},
    });

    expect(calls.map((call) => call.url)).toEqual([
      `${SCRIPTS_URL}/app-x/assets-upload-session`,
      `${SCRIPTS_URL}/app-x`,
    ]);

    const deployCall = calls[1];

    if (deployCall === undefined) {
      throw new Error("Expected the deploy request.");
    }

    const metadata = parseMetadata(requestFormData(deployCall.init));

    expect(metadata).toEqual({
      assets: { config: { not_found_handling: "none" }, jwt: "session-jwt" },
      compatibility_date: "2026-06-26",
    });
  });

  test("surfaces upload session failures with the response status", async () => {
    const { fetchImpl } = createRecordingFetch(() => new Response("boom", { status: 403 }));
    const client = createWfpDeploymentClient(BINDINGS, NAMESPACE, { fetch: fetchImpl });

    await expect(
      client.deployNamespacedWorker({
        assets: {
          files: [{ contentBase64: HELLO_BASE64, path: "/index.html" }],
          notFoundHandling: "none",
        },
        compatibilityDate: "2026-06-26",
        mainModule: null,
        scriptName: "app-x",
        vars: {},
      }),
    ).rejects.toThrow("asset upload session creation failed with status 403");
  });

  test("tolerates deleting a missing namespace script", async () => {
    const { calls, fetchImpl } = createRecordingFetch(() =>
      Response.json({ success: false }, { status: 404 }),
    );
    const client = createWfpDeploymentClient(BINDINGS, NAMESPACE, { fetch: fetchImpl });

    await client.deleteNamespacedWorker({ scriptName: "app-x" });

    const call = calls[0];

    if (call === undefined) {
      throw new Error("Expected a recorded delete request.");
    }

    expect(call.url).toBe(`${SCRIPTS_URL}/app-x`);
    expect(call.init.method).toBe("DELETE");
  });

  test("surfaces non-404 namespace script deletion failures", async () => {
    const { fetchImpl } = createRecordingFetch(() => new Response("nope", { status: 500 }));
    const client = createWfpDeploymentClient(BINDINGS, NAMESPACE, { fetch: fetchImpl });

    await expect(client.deleteNamespacedWorker({ scriptName: "app-x" })).rejects.toThrow(
      "dispatch namespace script deletion failed with status 500",
    );
  });
});
