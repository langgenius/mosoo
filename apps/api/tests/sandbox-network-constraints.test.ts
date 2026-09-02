import { describe, expect, test } from "bun:test";

import {
  normalizeSandboxNetworkHost,
  parseEnvironmentAllowedHosts,
  parseSandboxNetworkConstraints,
  resolveSandboxNetworkConstraints,
  toSandboxSystemHostsFromUrls,
} from "../src/modules/runtime/domain/sandbox-network-constraints";

describe("sandbox network constraints", () => {
  test("full policy carries no allowlist", () => {
    expect(
      resolveSandboxNetworkConstraints({
        environmentAllowedHosts: ["ignored.example.com"],
        networkPolicy: "full",
        systemHosts: ["also-ignored.example.com"],
      }),
    ).toEqual({ allowedHosts: [], networkPolicy: "full" });
  });

  test("limited policy merges system and environment hosts, deduped and sorted", () => {
    expect(
      resolveSandboxNetworkConstraints({
        environmentAllowedHosts: ["API.Example.com", "mcp.linear.project"],
        networkPolicy: "limited",
        systemHosts: ["api.anthropic.com", "api.example.com"],
      }),
    ).toEqual({
      allowedHosts: ["api.anthropic.com", "api.example.com", "mcp.linear.project"],
      networkPolicy: "limited",
    });
  });

  test("limited policy with no hosts denies everything", () => {
    expect(
      resolveSandboxNetworkConstraints({
        environmentAllowedHosts: [],
        networkPolicy: "limited",
        systemHosts: [],
      }),
    ).toEqual({ allowedHosts: [], networkPolicy: "limited" });
  });

  test("host normalization accepts canonical DNS/IP values and rejects wildcard syntax", () => {
    expect(normalizeSandboxNetworkHost("  API.Example.COM ")).toBe("api.example.com");
    expect(normalizeSandboxNetworkHost("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeSandboxNetworkHost("[::1]")).toBe("[::1]");
    expect(normalizeSandboxNetworkHost("[0:0:0:0:0:0:0:1]")).toBe("[::1]");
    expect(() => normalizeSandboxNetworkHost("")).toThrow("cannot be empty");
    expect(() => normalizeSandboxNetworkHost("https://example.com")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("example.com/path")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("bad host")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("*")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("*.example.com")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("example.com:443")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("example.com?target=*")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("user@example.com")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("999.1.1.1")).toThrow("bare hostname");
    expect(() => normalizeSandboxNetworkHost("[not-ipv6]")).toThrow("bare hostname");
  });

  test("environment allowlist snapshot parsing fails closed on malformed JSON", () => {
    expect(parseEnvironmentAllowedHosts('["a.example.com","b.example.com"]')).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
    expect(() => parseEnvironmentAllowedHosts("not json")).toThrow("not valid JSON");
    expect(() => parseEnvironmentAllowedHosts('{"hosts":[]}')).toThrow("array of strings");
    expect(() => parseEnvironmentAllowedHosts("[1]")).toThrow("array of strings");
    expect(() => parseEnvironmentAllowedHosts('["127.0.0.1"]')).toThrow("domain name");
    expect(() => parseEnvironmentAllowedHosts('["[::1]"]')).toThrow("domain name");
  });

  test("system host extraction handles URLs, proxy notation, and IPv6", () => {
    expect(
      toSandboxSystemHostsFromUrls([
        "https://cloud.mosoo.ai/api/runtime",
        "http://proxy.internal:3128",
        "proxy-host:8080",
        "https://abc123.r2.cloudflarestorage.com",
        "https://api.anthropic.com",
        null,
        undefined,
        "  ",
        "https://API.Anthropic.com/v1",
        "http://[::1]:8080",
      ]),
    ).toEqual([
      "cloud.mosoo.ai",
      "proxy.internal",
      "proxy-host",
      "abc123.r2.cloudflarestorage.com",
      "api.anthropic.com",
      "[::1]",
    ]);
  });

  test("system host extraction fails closed on unparsable values", () => {
    expect(() => toSandboxSystemHostsFromUrls(["http://"])).toThrow("not parseable");
  });

  test("constraint parsing validates RPC and storage payloads", () => {
    expect(
      parseSandboxNetworkConstraints({
        allowedHosts: ["A.example.com"],
        networkPolicy: "limited",
      }),
    ).toEqual({ allowedHosts: ["a.example.com"], networkPolicy: "limited" });
    expect(() => parseSandboxNetworkConstraints(null)).toThrow("must be an object");
    expect(() =>
      parseSandboxNetworkConstraints({ allowedHosts: [], networkPolicy: "open" }),
    ).toThrow("unknown network policy");
    expect(() =>
      parseSandboxNetworkConstraints({ allowedHosts: [42], networkPolicy: "limited" }),
    ).toThrow("array of strings");
    expect(() =>
      parseSandboxNetworkConstraints({ allowedHosts: ["*"], networkPolicy: "limited" }),
    ).toThrow("bare hostname");
    expect(() =>
      parseSandboxNetworkConstraints({ allowedHosts: ["api.example.com"], networkPolicy: "full" }),
    ).toThrow("cannot carry allowed hosts");
  });
});
