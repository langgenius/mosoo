import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { getSessionOrganizationPath, getSessionRuntimeStatePath } from "@mosoo/agent-driver/paths";
import { PLATFORM_ID_FIXTURES as ids } from "@mosoo/id/testing";
import { getPublicRuntimeCatalogEntry } from "@mosoo/runtime-catalog";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import { computeAgentReadiness } from "../src/modules/agents/application/agent-readiness.service";
import { createDriverInstanceRecord } from "../src/modules/runtime/infrastructure/driver-instance/driver-instance-record.repository";
import { readNativeResumeRef } from "../src/modules/runtime/infrastructure/driver-instance/native-resume-ref-event";
import { upsertNativeResumeRef } from "../src/modules/runtime/infrastructure/native-resume-ref.repository";
import { verifyRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { buildExecutionSpec } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-execution-spec.builder";
import { buildVendorProxyEnvVars } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-vendor-proxy-env.builder";
import { sandboxBindingForRuntime } from "../src/platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { createDriverProfile, API_DRIVER_BOUNDARY_IDS } from "./api-driver-boundary-fixtures";
import { createResolvedMcpServers } from "./api-driver-boundary-fixtures";
import { PUBLIC_API_TEST_IDS } from "./helpers/public-api-http-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

test("Given Pi v1, When selecting the public runtime, Then admit its Cloudflare image and honest capabilities", () => {
  const entry = getPublicRuntimeCatalogEntry("pi-acp");
  expect(entry).not.toBeNull();
  expect(entry?.vendors.map((v) => v.vendorId)).toEqual(["openai-compatible"]);
  expect(entry?.capabilities).toContainEqual({
    id: "mcp_execute",
    status: "unsupported",
    version: 1,
  });
  expect(sandboxBindingForRuntime("pi-acp")).toBe("SandboxPi");
});

test("Given a Pi credential, When provisioning, Then bind a Chat Completions grant without a raw key", async () => {
  const bindings = { RUNTIME_ACTION_TOKEN_SECRET: "pi-product-test" };
  const variables = await buildVendorProxyEnvVars({
    bindings,
    driverGeneration: 3,
    driverInstanceId: ids.driverInstance,
    requestUrl: "https://api.example.com/",
    profile: {
      runtimeId: "pi-acp",
      model: "gpt-5.5",
      vendorCredential: {
        vendorId: "openai-compatible",
        credentialId: ids.vendorCredential,
        projectId: ids.project,
        apiBase: "https://api.openai.com/v1",
        models: null,
      },
    },
  });
  expect(variables.OPENAI_COMPATIBLE_BASE_URL).toBe(
    `https://api.example.com/api/driver/llm/proxy/${ids.vendorCredential}`,
  );
  expect(
    await verifyRuntimeActionToken(bindings, variables.OPENAI_COMPATIBLE_API_KEY ?? ""),
  ).toMatchObject({
    modelId: "gpt-5.5",
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
      runtimeId: "pi-acp" as const,
      provider: "openai-compatible",
      providerOptions: {},
      permissionPolicy: "full_access" as const,
      session: {
        ...profile.session,
        homePath: getSessionRuntimeStatePath(API_DRIVER_BOUNDARY_IDS.session, "pi-acp"),
        sessionOrganizationPath: getSessionOrganizationPath(API_DRIVER_BOUNDARY_IDS.session),
      },
      vendorCredential: { ...profile.vendorCredential, vendorId: "openai-compatible" },
    },
  };
}

test("Given a Pi session, When creating its execution, Then preserve checkpointed HOME and omit unsupported directories", async () => {
  const input = piInput();
  const spec = await buildExecutionSpec({ RUNTIME_ACTION_TOKEN_SECRET: "pi-product-test" }, input);
  expect(spec.session.additionalDirectories).toEqual([]);
  expect(spec.session.context.homePath.startsWith(`${spec.session.cwd}/`)).toBe(true);
  expect(spec.session.nativeResumeRequired).toBe(true);
  expect(spec.provider).toBe("openai-compatible");
});

test("Given unsupported Pi MCP or permission settings, When building execution, Then reject before launch", async () => {
  const input = piInput();
  const bindings = { RUNTIME_ACTION_TOKEN_SECRET: "pi-product-test" };
  await expect(
    buildExecutionSpec(bindings, { ...input, resolvedMcpServers: createResolvedMcpServers() }),
  ).rejects.toThrow("Pi does not support MCP");
  await expect(
    buildExecutionSpec(bindings, {
      ...input,
      profile: { ...input.profile, permissionPolicy: "supervised" },
    }),
  ).rejects.toThrow("Pi requires full_access");
  await expect(
    buildExecutionSpec(bindings, { ...input, builtInTools: [{ name: "bash", enabled: false }] }),
  ).rejects.toThrow("unrestricted");
});

test("Given a Pi native session event, When recording continuation, Then use the ACP native cursor", () => {
  const event = createRuntimeEvent({
    id: API_DRIVER_BOUNDARY_IDS.runtimeEvent,
    kind: "runtime.resume.updated",
    occurredAt: "1970-01-01T00:00:00.010Z",
    sessionId: API_DRIVER_BOUNDARY_IDS.session,
    runtimeId: "pi-acp",
    payload: { resumePointer: "pi-session" },
  });
  expect(readNativeResumeRef(event)).toEqual({
    runtimeId: "pi-acp",
    kind: "acp_session_id",
    value: "pi-session",
  });
});

test("Given a Pi session, When claiming a Driver and receiving native state, Then persist both through product repositories", async () => {
  const db = new SqliteD1Database({ foreignKeys: false });
  const migrations = new URL("../../../pkgs/db/drizzle/", import.meta.url);
  for (const migrationName of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    db.execute(readFileSync(new URL(migrationName, migrations), "utf8"));
  }
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
    runtime: "pi-acp",
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sandboxSessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  expect(result.status).toBe("created");
  await upsertNativeResumeRef(db, {
    driverInstanceId: API_DRIVER_BOUNDARY_IDS.driverInstance,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    sessionRunId: null,
    nativeResumeRef: { runtimeId: "pi-acp", kind: "acp_session_id", value: "pi-session" },
  });
  expect(
    await db
      .prepare("SELECT runtime, protocol_version FROM driver_instance WHERE id = ?")
      .bind(API_DRIVER_BOUNDARY_IDS.driverInstance)
      .first(),
  ).toMatchObject({ runtime: "pi-acp", protocol_version: 6 });
  expect(
    await db
      .prepare(
        "SELECT runtime_id, value, committed_value FROM native_resume_ref WHERE session_id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .first(),
  ).toMatchObject({ runtime_id: "pi-acp", value: "pi-session", committed_value: null });
});

test("Given Pi with snapshot MCP bindings, When checking readiness, Then block before publishing or credential probing", async () => {
  const readiness = await computeAgentReadiness(new SqliteD1Database(), ids.account, {
    agentId: null,
    builtInTools: [],
    environment: { environmentId: null },
    model: "gpt-5.5",
    mcpServerIds: [ids.mcpServer],
    projectId: ids.project,
    provider: "openai-compatible",
    runtimeId: "pi-acp",
  });
  expect(readiness.ready).toBe(false);
  expect(readiness.issues).toContainEqual(
    expect.objectContaining({ code: "agent.runtime.mcp_unsupported", severity: "error" }),
  );
});
