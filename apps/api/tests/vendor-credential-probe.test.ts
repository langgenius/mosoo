import { describe, expect, test } from "bun:test";

import type { PresetModelProtocol } from "@mosoo/contracts/models";

import {
  readVendorProbeBaseHost,
  readVendorProbeErrorCode,
  toVendorProbeEndpointUrl,
  validateVendorProbeBaseUrl,
  vendorProbeModelListIncludes,
} from "../src/modules/vendor-credentials/application/vendor-credential-probe";
import { probeVendorCredential } from "../src/modules/vendor-credentials/application/vendor-credential-test";

describe("vendor credential probe", () => {
  test.each(["json", "text"] as const)(
    "Given an echoed Go key, When reading a %s probe error, Then the key is redacted",
    async (format) => {
      const message = "Invalid API key oc_sk_test-secret_123; replace sk-legacy-secret";
      const response =
        format === "json"
          ? Response.json({ error: { message } }, { status: 401 })
          : new Response(message, { status: 401 });

      expect(await readVendorProbeErrorCode(response)).toBe(
        "http_401: Invalid API key oc_sk_***; replace sk-***",
      );
    },
  );

  test("builds v1 endpoint URLs from vendor API bases", () => {
    expect(toVendorProbeEndpointUrl("https://api.example.com", "models")).toBe(
      "https://api.example.com/v1/models",
    );
    expect(toVendorProbeEndpointUrl("https://api.example.com/v1/", "chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(
      toVendorProbeEndpointUrl("https://generativelanguage.googleapis.com/v1beta", "models"),
    ).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    expect(toVendorProbeEndpointUrl("https://api.z.ai/api/paas/v4", "models")).toBe(
      "https://api.z.ai/api/paas/v4/models",
    );
  });

  test("rejects local and private API base URLs", () => {
    for (const baseUrl of [
      "http://localhost:11434",
      "https://localhost.",
      "http://0.0.0.0:11434",
      "http://10.0.0.2",
      "http://100.64.0.1",
      "http://127.0.0.1",
      "https://127.0.0.1.",
      "http://169.254.169.254",
      "http://172.16.0.1",
      "http://192.168.0.1",
      "http://198.18.0.1",
      "http://[::]",
      "http://[::1]",
      "http://[::ffff:127.0.0.1]",
      "http://[fd00::1]",
      "http://[fe80::1]",
    ]) {
      expect(validateVendorProbeBaseUrl(baseUrl), baseUrl).toBe("blocked_api_base");
    }
  });

  test("rejects credential-bearing API base URLs", () => {
    expect(validateVendorProbeBaseUrl("https://user:pass@api.example.com/v1")).toBe(
      "blocked_api_base",
    );
  });

  test("accepts public HTTPS API bases and exposes host for logging", () => {
    const baseUrl = "https://api.example.com/v1";

    expect(validateVendorProbeBaseUrl(baseUrl)).toBeNull();
    expect(readVendorProbeBaseHost(baseUrl)).toBe("api.example.com");
  });

  test("rejects public HTTP API bases", async () => {
    const fetchUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetchUrls.push(typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url);
      return Response.json({});
    };

    try {
      expect(validateVendorProbeBaseUrl("http://api.example.com/v1")).toBe("insecure_api_base");

      const result = await probeVendorCredential({
        apiBase: "http://api.example.com/v1",
        apiKey: "sk-probe",
        modelId: "custom-model",
        vendorId: "openai-compatible",
      });

      expect(fetchUrls).toEqual([]);
      expect(result).toMatchObject({
        errorCode: "insecure_api_base",
        ok: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reads model ids from common provider list shapes", () => {
    expect(vendorProbeModelListIncludes({ data: [{ id: "model-a" }] }, "model-a")).toBe(true);
    expect(vendorProbeModelListIncludes(["model-a"], "model-a")).toBe(true);
    expect(vendorProbeModelListIncludes({ data: [{ name: "model-a" }] }, "model-a")).toBe(false);
    expect(vendorProbeModelListIncludes({ models: [{ name: "models/model-a" }] }, "model-a")).toBe(
      true,
    );
    expect(
      vendorProbeModelListIncludes({ models: [{ name: "models/model-a" }] }, "models/model-a"),
    ).toBe(true);
  });

  test.each([false, true])(
    "probes the Gemini preset with native endpoint and auth (verify model: %s)",
    async (verifyModelProtocol) => {
      const originalFetch = globalThis.fetch;
      const requests: Request[] = [];
      globalThis.fetch = async (url, init) => {
        requests.push(new Request(url, init));
        return Response.json(
          verifyModelProtocol
            ? { candidates: [{ content: { parts: [{ text: "pong" }], role: "model" } }] }
            : { models: [{ name: "models/gemini-3.5-flash" }] },
        );
      };
      try {
        expect(
          await probeVendorCredential({
            apiKey: "probe-key",
            modelId: "gemini-3.5-flash",
            vendorId: "gemini",
            verifyModelProtocol,
          }),
        ).toMatchObject({ ok: true });
        expect(requests).toHaveLength(1);
        const request = requests[0];
        expect(request.url).toBe(
          `https://generativelanguage.googleapis.com/v1beta/models${verifyModelProtocol ? "/gemini-3.5-flash:generateContent" : ""}`,
        );
        expect(request.method).toBe(verifyModelProtocol ? "POST" : "GET");
        expect(request.headers.get("x-goog-api-key")).toBe("probe-key");
        expect(request.headers.has("authorization")).toBe(false);
        if (verifyModelProtocol) {
          expect(await request.json()).toMatchObject({
            contents: [{ parts: [{ text: "ping" }], role: "user" }],
          });
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    },
  );

  const protocolCases: {
    protocol: PresetModelProtocol;
    path: string;
    authHeader: string;
    authValue: string;
    response: object;
  }[] = [
    {
      protocol: "openai-chat-completions",
      path: "/chat/completions",
      authHeader: "Authorization",
      authValue: "Bearer probe-key",
      response: {
        choices: [{ message: { content: "pong", role: "assistant" }, finish_reason: "stop" }],
      },
    },
    {
      protocol: "openai-responses",
      path: "/responses",
      authHeader: "Authorization",
      authValue: "Bearer probe-key",
      response: { object: "response", status: "completed", output: [] },
    },
    {
      protocol: "anthropic-messages",
      path: "/v1/messages",
      authHeader: "x-api-key",
      authValue: "probe-key",
      response: { type: "message", content: [{ type: "text", text: "pong" }] },
    },
    {
      protocol: "google-gemini",
      path: "/models/model-a:generateContent",
      authHeader: "x-goog-api-key",
      authValue: "probe-key",
      response: { candidates: [{ content: { parts: [{ text: "pong" }], role: "model" } }] },
    },
  ];

  for (const entry of protocolCases) {
    test(`explicit ${entry.protocol} testing calls its model API with matching auth`, async () => {
      const originalFetch = globalThis.fetch;
      const requests: Request[] = [];
      globalThis.fetch = async (url, init) => {
        requests.push(new Request(url, init));
        return Response.json(entry.response);
      };
      try {
        const result = await probeVendorCredential({
          apiBase: "https://models.example.com/gateway",
          apiKey: "probe-key",
          modelId: "model-a",
          modelProtocol: entry.protocol,
          vendorId: "openai-compatible",
          verifyModelProtocol: true,
        });
        expect(result.ok).toBe(true);
        expect(requests).toHaveLength(1);
        const request = requests[0];
        expect(request.url).toBe(`https://models.example.com/gateway${entry.path}`);
        expect(request.method).toBe("POST");
        expect(request.headers.get(entry.authHeader)).toBe(entry.authValue);
        if (entry.authHeader !== "Authorization")
          expect(request.headers.has("Authorization")).toBe(false);
        const body = await request.json();
        if (entry.protocol === "google-gemini") {
          expect(body).toMatchObject({ contents: [{ parts: [{ text: "ping" }], role: "user" }] });
        } else {
          expect(body).toMatchObject({ model: "model-a" });
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  test("Responses-only readiness never falls back to Chat Completions", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (url) => {
      const request = new Request(url);
      urls.push(request.url);
      return request.url.endsWith("/models")
        ? new Response(null, { status: 404 })
        : Response.json({ output: [] });
    };
    try {
      const result = await probeVendorCredential({
        apiBase: "https://models.example.com/v1",
        apiKey: "probe-key",
        modelId: "model-a",
        modelProtocol: "openai-responses",
        vendorId: "openai-compatible",
      });
      expect(result.ok).toBe(true);
      expect(urls).toEqual([
        "https://models.example.com/v1/models",
        "https://models.example.com/v1/responses",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Anthropic probe does not duplicate a versioned base path", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (url) => {
      urls.push(new Request(url).url);
      return Response.json({ type: "message", content: [] });
    };
    try {
      const result = await probeVendorCredential({
        apiBase: "https://models.example.com/anthropic/v1/",
        apiKey: "probe-key",
        modelId: "model-a",
        modelProtocol: "anthropic-messages",
        vendorId: "openai-compatible",
        verifyModelProtocol: true,
      });
      expect(result.ok).toBe(true);
      expect(urls).toEqual(["https://models.example.com/anthropic/v1/messages"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("successful HTTP with a different protocol shape is not a passing protocol test", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ choices: [] });
    try {
      expect(
        await probeVendorCredential({
          apiBase: "https://models.example.com/v1",
          apiKey: "probe-key",
          modelId: "model-a",
          modelProtocol: "openai-responses",
          vendorId: "openai-compatible",
          verifyModelProtocol: true,
        }),
      ).toMatchObject({ errorCode: "invalid_model_response", ok: false });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  for (const status of ["failed", "queued", "in_progress", "cancelled"]) {
    test(`HTTP 200 Responses ${status} is not a passing model test`, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        Response.json({
          id: "resp_probe",
          object: "response",
          status,
          output: [],
          error: status === "failed" ? { code: "server_error", message: "Model failed" } : null,
        });
      try {
        expect(
          await probeVendorCredential({
            apiBase: "https://models.example.com/v1",
            apiKey: "probe-key",
            modelId: "model-a",
            modelProtocol: "openai-responses",
            vendorId: "openai-compatible",
            verifyModelProtocol: true,
          }),
        ).toMatchObject({ errorCode: "invalid_model_response", ok: false });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test("Given a Go key, When testing a model, Then the probe identifies Mosoo and uses Go auth", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Request[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push(new Request(url, init));
    return Response.json({ type: "message", content: [{ type: "text", text: "pong" }] });
  };
  try {
    const result = await probeVendorCredential({
      apiKey: "probe-key",
      modelId: "minimax-m2.7",
      vendorId: "opencode-go",
      versionMetadata: { id: "go-probe-release" },
      verifyModelProtocol: true,
    });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(requests[0].headers.get("authorization")).toBe("Bearer probe-key");
    expect(requests[0].headers.get("user-agent")).toBe("mosoo/go-probe-release");
    expect(requests[0].headers.get("x-opencode-session")).toMatch(/^[a-f0-9-]{36}$/);
    expect(requests[0].headers.get("anthropic-version")).toBe("2023-06-01");
    expect(requests[0].headers.has("x-api-key")).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.each([true, false])(
  "Go credential tests verify inference authentication when the public model list is accessible (valid=%s)",
  async (validKey) => {
    const originalFetch = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = async (url, init) => {
      const request = new Request(url, init);
      requests.push(request);
      if (request.method === "GET") {
        return Response.json({ data: [{ id: "deepseek-v4.1-flash" }] });
      }
      return validKey
        ? Response.json({ choices: [{ message: { content: "pong" } }] })
        : Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
    };
    try {
      const result = await probeVendorCredential({ apiKey: "probe-key", vendorId: "opencode-go" });
      expect(result.ok).toBe(validKey);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("POST");
      expect(await requests[0]?.json()).toMatchObject({
        model: "deepseek-v4.1-flash",
        max_tokens: 1,
      });
      if (!validKey) expect(result.errorCode).toStartWith("http_401");
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
);
