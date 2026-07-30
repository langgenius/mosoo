import { describe, expect, test } from "bun:test";

import { resolveRuntimeSubjectNetworkConstraints } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-network";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

function createBindings(overrides: Record<string, string> = {}): ApiBindings {
  return overrides as unknown as ApiBindings;
}

const LIMITED_NETWORK = {
  environmentAllowedHosts: ["mcp.linear.app", "api.example.com"],
  networkPolicy: "limited",
} as const;

describe("runtime subject network constraints", () => {
  test("Full keeps the sandbox defaults for a stable Pet subject", () => {
    expect(
      resolveRuntimeSubjectNetworkConstraints(createBindings(), {
        envVars: {},
        kind: "pet",
        network: {
          environmentAllowedHosts: ["api.example.com"],
          networkPolicy: "full",
        },
        requestUrl: "https://cloud.mosoo.ai/api/session",
        subjectKind: "agent",
      }),
    ).toEqual({ allowedHosts: [], networkPolicy: "full" });
  });

  test("Limited allowlists only the control origin and environment hosts", () => {
    expect(
      resolveRuntimeSubjectNetworkConstraints(createBindings(), {
        envVars: {},
        kind: "cattle",
        network: LIMITED_NETWORK,
        requestUrl: "https://cloud.mosoo.ai/api/session",
        subjectKind: "session",
      }),
    ).toEqual({
      allowedHosts: ["api.example.com", "cloud.mosoo.ai", "mcp.linear.app"],
      networkPolicy: "limited",
    });
  });

  test("Limited includes the R2 backup endpoint but never ambient egress proxies", () => {
    expect(
      resolveRuntimeSubjectNetworkConstraints(
        createBindings({
          CLOUDFLARE_ACCOUNT_ID: "abc123",
          MOSOO_RUNTIME_HTTPS_PROXY: "http://egress.proxy.internal:3128",
        }),
        {
          envVars: {},
          kind: "cattle",
          network: LIMITED_NETWORK,
          requestUrl: "https://cloud.mosoo.ai/api/session",
          subjectKind: "session",
        },
      ).allowedHosts,
    ).toEqual([
      "abc123.r2.cloudflarestorage.com",
      "api.example.com",
      "cloud.mosoo.ai",
      "mcp.linear.app",
    ]);
  });

  test("explicit backup endpoint and control origin override the derived values", () => {
    expect(
      resolveRuntimeSubjectNetworkConstraints(
        createBindings({
          BACKUP_BUCKET_ENDPOINT: "https://abc123.eu.r2.cloudflarestorage.com",
          CLOUDFLARE_ACCOUNT_ID: "abc123",
          MOSOO_RUNTIME_CONTROL_ORIGIN: "https://control.mosoo.ai",
        }),
        {
          envVars: {},
          kind: "cattle",
          network: { ...LIMITED_NETWORK, environmentAllowedHosts: [] },
          requestUrl: "https://cloud.mosoo.ai/api/session",
          subjectKind: "session",
        },
      ).allowedHosts,
    ).toEqual(["abc123.eu.r2.cloudflarestorage.com", "control.mosoo.ai"]);
  });

  test("local request URLs map to the container-reachable host", () => {
    expect(
      resolveRuntimeSubjectNetworkConstraints(createBindings(), {
        envVars: {},
        kind: "cattle",
        network: { ...LIMITED_NETWORK, environmentAllowedHosts: [] },
        requestUrl: "http://localhost:8787/api/session",
        subjectKind: "session",
      }).allowedHosts,
    ).toEqual(["host.docker.internal"]);
  });

  test("Limited rejects stable Pet subjects at admission", () => {
    expect(() =>
      resolveRuntimeSubjectNetworkConstraints(createBindings(), {
        envVars: {},
        kind: "pet",
        network: LIMITED_NETWORK,
        requestUrl: "https://cloud.mosoo.ai/api/session",
        subjectKind: "agent",
      }),
    ).toThrow("only for Task Agents");
  });

  test("Limited rejects ordinary proxy variables at admission", () => {
    expect(() =>
      resolveRuntimeSubjectNetworkConstraints(createBindings(), {
        envVars: {
          HTTPS_PROXY: "http://proxy.internal:3128",
          http_proxy: "http://proxy.internal:3128",
        },
        kind: "cattle",
        network: LIMITED_NETWORK,
        requestUrl: "https://cloud.mosoo.ai/api/session",
        subjectKind: "session",
      }),
    ).toThrow("HTTPS_PROXY, http_proxy");
  });
});
