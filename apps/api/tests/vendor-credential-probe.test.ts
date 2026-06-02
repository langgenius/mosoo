import { describe, expect, test } from "bun:test";

import {
  readVendorProbeBaseHost,
  toVendorProbeEndpointUrl,
  validateVendorProbeBaseUrl,
  vendorProbeModelListIncludes,
} from "../src/modules/vendor-credentials/application/vendor-credential-probe";

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
      "http://0.0.0.0:11434",
      "http://10.0.0.2",
      "http://100.64.0.1",
      "http://127.0.0.1",
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

  test("accepts public HTTPS API bases and exposes host for logging", () => {
    const baseUrl = "https://api.example.com/v1";

    expect(validateVendorProbeBaseUrl(baseUrl)).toBeNull();
    expect(readVendorProbeBaseHost(baseUrl)).toBe("api.example.com");
  });

  test("reads model ids from common provider list shapes", () => {
    expect(vendorProbeModelListIncludes({ data: [{ id: "model-a" }] }, "model-a")).toBe(true);
    expect(vendorProbeModelListIncludes(["model-a"], "model-a")).toBe(true);
    expect(vendorProbeModelListIncludes({ data: [{ name: "model-a" }] }, "model-a")).toBe(false);
  });
});
