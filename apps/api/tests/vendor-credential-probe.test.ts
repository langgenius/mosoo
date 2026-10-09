import { describe, expect, test } from "bun:test";

import type { PresetModelProtocol } from "@mosoo/contracts/models";

import {
  readVendorProbeBaseHost,
  toVendorProbeEndpointUrl,
  validateVendorProbeBaseUrl,
  vendorProbeModelListIncludes,
} from "../src/modules/vendor-credentials/application/vendor-credential-probe";
import { probeVendorCredential } from "../src/modules/vendor-credentials/application/vendor-credential-test";

describe("vendor credential probe", () => {
  test("builds v1 endpoint URLs from vendor API bases", () => {
    expect(toVendorProbeEndpointUrl("https://api.example.com", "models")).toBe(
      "https://api.example.com/v1/models",
    );
    expect(toVendorProbeEndpointUrl("https://api.example.com/v1/", "chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(
      toVendorProbeEndpointUrl("https://generativelanguage.googleapis.com/v1beta/openai", "models"),
    ).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
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
