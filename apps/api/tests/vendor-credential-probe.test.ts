import { describe, expect, test } from "bun:test";

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
        emitEvent: false,
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
  });
});
