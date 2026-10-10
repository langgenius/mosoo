import { expect, test } from "bun:test";

import { DRIVER_PROTOCOL_VERSION } from "@mosoo/agent-driver/boot";
import { getSessionOrganizationPath, getSessionRuntimeStatePath } from "@mosoo/agent-driver/paths";
import { PLATFORM_ID_FIXTURES as ids } from "@mosoo/id/testing";
import { getRuntimeCatalogEntry, resolveRuntimeModelProtocol } from "@mosoo/runtime-catalog";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { createDriverInstanceRecord } from "../src/modules/runtime/infrastructure/driver-instance/driver-instance-record.repository";
import { readNativeResumeRef } from "../src/modules/runtime/infrastructure/driver-instance/native-resume-ref-event";
import { upsertNativeResumeRef } from "../src/modules/runtime/infrastructure/native-resume-ref.repository";
import { verifyRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { buildExecutionSpec } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder";
import { buildVendorProxyEnvVars } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-vendor-proxy-env.builder";
import { sandboxBindingForRuntime } from "../src/platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createDriverProfile,
  createResolvedMcpServers,
  API_DRIVER_BOUNDARY_IDS,
} from "./api-driver-boundary-fixtures";
import {
  PUBLIC_API_TEST_IDS,
  createMigratedTestDatabase,
} from "./helpers/public-api-http-test-fixture";

test("Given Pi v1, When selecting the public runtime, Then admit its Cloudflare image and models", () => {
  const entry = getRuntimeCatalogEntry("pi");
  expect(entry).not.toBeNull();
  expect(entry?.vendors.map((v) => v.vendorId)).toContain("openai-compatible");
  expect(
    resolveRuntimeModelProtocol({ runtimeId: "pi", vendorId: "openai", modelId: "gpt-5.5" }),
  ).toEqual({
    ok: true,
    modelProtocol: "openai-responses",
  });
  expect(sandboxBindingForRuntime("pi")).toBe("SandboxPi");
});

test("Given a Pi credential, When provisioning, Then bind a Chat Completions grant without a raw key", async () => {
  const bindings = { RUNTIME_ACTION_TOKEN_SECRET: "pi-product-test" };
  const variables = await buildVendorProxyEnvVars({
    bindings,
    driverGeneration: 3,
    driverInstanceId: ids.driverInstance,
    requestUrl: "https://api.example.com/",
    profile: {
      runtimeId: "pi",
      model: "custom-model",
      vendorCredential: {
        vendorId: "openai-compatible",
        credentialId: ids.vendorCredential,
        projectId: ids.project,
        apiBase: "https://gateway.example.com/v1",
        models: ["custom-model"],
      },
    },
  });
  expect(JSON.parse(variables.MOSOO_PI_CONFIG_CONTENT ?? "{}")).toEqual({
    baseUrl: `https://api.example.com/api/driver/llm/proxy/${ids.vendorCredential}`,
    modelProtocol: "openai-chat-completions",
  });
  expect(
    await verifyRuntimeActionToken(bindings, variables.MOSOO_PI_PROXY_GRANT ?? ""),
  ).toMatchObject({
    modelId: "custom-model",
    modelProtocol: "openai-chat-completions",
    driverGeneration: 3,
  });
});

function piInput() {
  const profile = createDriverProfile();
  return {
    builtInTools: [],
    driverGeneration: 3,
    driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
    requestUrl: "https://api.example.com/",
    resolvedMcpServers: [],
    resolvedSkills: [],
    resolvedSkillCatalog: [],
    profile: {
      ...profile,
      runtimeId: "pi" as const,
      model: "custom-model",
      provider: "openai-compatible",
      providerOptions: {},
      session: {
        ...profile.session,
        homePath: getSessionRuntimeStatePath(API_DRIVER_BOUNDARY_IDS.session, "pi"),
        sessionOrganizationPath: getSessionOrganizationPath(API_DRIVER_BOUNDARY_IDS.session),
      },
      vendorCredential: {
        ...profile.vendorCredential,
        vendorId: "openai-compatible",
        apiBase: "https://gateway.example.com/v1",
        models: ["custom-model"],
      },
    },
  };
}

test("Given a Pi session, When creating its execution, Then preserve checkpointed HOME and native continuation", async () => {
  const input = piInput();
  const spec = await buildExecutionSpec({ RUNTIME_ACTION_TOKEN_SECRET: "pi-product-test" }, input);
  expect(spec.session.context.homePath.startsWith(`${spec.session.cwd}/`)).toBe(true);
  expect(spec.session.nativeCheckpoint).toBeNull();
  expect(spec.session.nativeResumeRef).toBeNull();
  expect(spec.provider).toBe("openai-compatible");
});

test("Given Pi MCP bindings, When building execution, Then issue the usual scoped proxy grants", async () => {
  const bindings = { RUNTIME_ACTION_TOKEN_SECRET: "pi-product-test" };
  const spec = await buildExecutionSpec(bindings, {
    ...piInput(),
    resolvedMcpServers: createResolvedMcpServers(),
  });
  const active = spec.session.mcpServers.find((server) => server.authorizationState === "active");
  expect(active).toMatchObject({
    authorizationState: "active",
    proxyUrl: `https://api.example.com/api/driver/mcp/proxy/${API_DRIVER_BOUNDARY_IDS.mcpServerLinear}`,
  });
  if (active?.authorizationState !== "active") throw new Error("Missing active MCP binding.");
  expect(await verifyRuntimeActionToken(bindings, active.proxyGrantId)).toMatchObject({
    action: "mcp_proxy",
    driverGeneration: 3,
    driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
    resourceId: API_DRIVER_BOUNDARY_IDS.mcpServerLinear,
  });
});

test("Given a Pi native session event, When recording continuation, Then use the Pi native session path", () => {
  const event = createRuntimeEvent({
    id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
    kind: "runtime.resume.updated",
    occurredAt: "1970-01-01T00:00:00.010Z",
    sessionId: API_DRIVER_BOUNDARY_IDS.session,
    runtimeId: "pi",
    payload: { resumePointer: "sessions/pi-session.jsonl" },
  });
  expect(readNativeResumeRef(event)).toEqual({
    runtimeId: "pi",
    kind: "pi_session_path",
    value: "sessions/pi-session.jsonl",
  });
});

test("Given a Pi session, When claiming a Driver and receiving native state, Then persist both through product repositories", async () => {
  const db = createMigratedTestDatabase();
  await db
    .prepare(
      "INSERT OR REPLACE INTO sandbox_session (cloudflare_session_id, created_at, cwd, origin_json, sandbox_id, session_id, status, updated_at) VALUES (?, 1, ?, ?, ?, ?, 'active', 1)",
    )
    .bind(
      API_DRIVER_BOUNDARY_IDS.sandboxSession,
      getSessionOrganizationPath(PUBLIC_API_TEST_IDS.ownerSession),
      "{}",
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
    )
    .run();
  const result = await createDriverInstanceRecord({ DB: db } as ApiBindings, {
    bootTokenHash: new Uint8Array(32),
    driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
    executionSessionId: API_DRIVER_BOUNDARY_IDS.sandboxSession,
    runtime: "pi",
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sandboxSessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  expect(result.status).toBe("created");
  await upsertNativeResumeRef(db, {
    driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    sessionRunId: null,
    nativeResumeRef: {
      runtimeId: "pi",
      kind: "pi_session_path",
      value: "sessions/pi-session.jsonl",
    },
  });
  expect(
    await db
      .prepare("SELECT runtime, protocol_version FROM driver_instance WHERE id = ?")
      .bind(API_DRIVER_BOUNDARY_IDS.driverInstance)
      .first(),
  ).toMatchObject({ runtime: "pi", protocol_version: DRIVER_PROTOCOL_VERSION });
  expect(
    await db
      .prepare(
        "SELECT runtime_id, value, committed_value FROM native_resume_ref WHERE session_id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .first(),
  ).toMatchObject({ runtime_id: "pi", value: "sessions/pi-session.jsonl", committed_value: null });
});
