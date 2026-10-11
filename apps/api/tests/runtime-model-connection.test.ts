import { describe, expect, test } from "bun:test";

import type { DriverModelConnection } from "@mosoo/agent-driver/boot";
import { PLATFORM_ID_FIXTURES as ids } from "@mosoo/id/testing";
import { PRESET_MODEL_CATALOG } from "@mosoo/runtime-catalog";

import type { DriverVendorCredentialProfile } from "../src/modules/runtime/domain/driver-snapshot";
import { verifyRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { buildModelConnection } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-model-connection.builder";
import { sanitizeRuntimeVendorEnvVars } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-vendor-env-policy";

const BINDINGS = { RUNTIME_ACTION_TOKEN_SECRET: "test-runtime-model-connection" };
const REQUEST_URL = "https://api.example.com/api/agents/run?probe=1";
const PROXY_URL = `https://api.example.com/api/driver/llm/proxy/${ids.vendorCredential}`;

function credential(
  overrides: Partial<DriverVendorCredentialProfile> & { vendorId: string },
): DriverVendorCredentialProfile {
  return {
    apiBase: null,
    projectId: ids.project,
    credentialId: ids.vendorCredential,
    models: null,
    ...overrides,
  };
}

async function expectConnection(
  connection: DriverModelConnection,
  modelId: string,
  protocol: DriverModelConnection["protocol"],
  imageModelId?: string,
) {
  expect(connection).toEqual({ protocol, proxyUrl: PROXY_URL, proxyGrant: expect.any(String) });
  const grant = await verifyRuntimeActionToken(BINDINGS, connection.proxyGrant);
  expect(grant).toMatchObject({
    action: "llm_proxy",
    driverInstanceId: ids.driverInstance,
    projectId: ids.project,
    resourceId: ids.vendorCredential,
    modelId,
    modelProtocol: protocol,
  });
  expect("imageModelId" in grant ? grant.imageModelId : undefined).toBe(imageModelId);
}

function build(profile: Parameters<typeof buildModelConnection>[0]["profile"]) {
  return buildModelConnection({
    bindings: BINDINGS,
    driverInstanceId: ids.driverInstance,
    profile,
    requestUrl: REQUEST_URL,
  });
}

describe("runtime model connections", () => {
  test("removes runtime-managed environment variables before sandbox setup", () => {
    expect(
      sanitizeRuntimeVendorEnvVars({
        ANTHROPIC_API_KEY: "untrusted-key",
        OPENAI_BASE_URL: "https://attacker.example.com/v1",
        OPENCODE_CONFIG_CONTENT: '{"provider":{"openai":{"options":{"apiKey":"raw"}}}}',
        EXISTING_ENV: "kept",
      }),
    ).toEqual({ EXISTING_ENV: "kept" });
  });

  test.each(PRESET_MODEL_CATALOG)(
    "binds preset $vendorId/$modelId to its catalog protocol for Pi and OpenCode",
    async ({ vendorId, modelId, protocol }) => {
      for (const runtimeId of ["pi", "acp-fallback"] as const) {
        await expectConnection(
          await build({ runtimeId, model: modelId, vendorCredential: credential({ vendorId }) }),
          modelId,
          protocol,
        );
      }
    },
  );

  test.each([
    "openai-chat-completions",
    "openai-responses",
    "anthropic-messages",
    "google-gemini",
  ] as const)("binds a custom %s endpoint without exposing the upstream URL", async (protocol) => {
    for (const runtimeId of ["pi", "acp-fallback"] as const) {
      await expectConnection(
        await build({
          runtimeId,
          model: "openai-compatible/vendor/custom-model",
          modelProtocol: protocol,
          vendorCredential: credential({
            vendorId: "openai-compatible",
            apiBase: "https://gateway.example.com/v1?api-version=2026-07-01",
            modelProtocol: protocol,
            models: ["vendor/custom-model", "another-model"],
          }),
        }),
        "vendor/custom-model",
        protocol,
      );
    }
  });

  test("issues the native Claude connection", async () => {
    await expectConnection(
      await build({
        runtimeId: "claude-agent-sdk",
        model: "anthropic/claude-sonnet-5",
        vendorCredential: credential({ vendorId: "anthropic" }),
      }),
      "claude-sonnet-5",
      "anthropic-messages",
    );
  });

  test("limits the OpenAI image grant to the native OpenAI runtime", async () => {
    await expectConnection(
      await build({
        runtimeId: "openai-runtime",
        model: "gpt-5.4",
        vendorCredential: credential({ vendorId: "openai" }),
      }),
      "gpt-5.4",
      "openai-responses",
      "gpt-image-2",
    );
    await expectConnection(
      await build({
        runtimeId: "openai-runtime",
        model: "gpt-custom",
        vendorCredential: credential({
          vendorId: "openai-compatible",
          apiBase: "https://gateway.example.com/v1",
          modelProtocol: "openai-responses",
        }),
      }),
      "gpt-custom",
      "openai-responses",
    );
  });

  test.each(["deepseek/deepseek-v4-flash", "openai-compatible/deepseek/deepseek-v4-flash"])(
    "preserves the upstream namespace in %s",
    async (model) => {
      await expectConnection(
        await build({
          runtimeId: "acp-fallback",
          model,
          vendorCredential: credential({
            vendorId: "openai-compatible",
            apiBase: "https://gateway.example.com/v1",
          }),
        }),
        "deepseek/deepseek-v4-flash",
        "openai-chat-completions",
      );
    },
  );

  test("rejects a custom credential without an endpoint", async () => {
    await expect(
      build({
        runtimeId: "pi",
        model: "custom-model",
        vendorCredential: credential({ vendorId: "openai-compatible" }),
      }),
    ).rejects.toThrow("Custom providers require an endpoint");
  });

  test("rejects a credential protocol changed after admission", async () => {
    await expect(
      build({
        runtimeId: "pi",
        model: "custom-model",
        modelProtocol: "openai-responses",
        vendorCredential: credential({
          vendorId: "openai-compatible",
          apiBase: "https://gateway.example.com/v1",
          modelProtocol: "anthropic-messages",
        }),
      }),
    ).rejects.toThrow("differs from the frozen execution configuration");
  });

  test("rejects an unsupported runtime and provider pair", async () => {
    await expect(
      build({
        runtimeId: "claude-agent-sdk",
        model: "deepseek-v4-pro",
        vendorCredential: credential({ vendorId: "opencode" }),
      }),
    ).rejects.toThrow("does not support provider opencode");
  });
});
