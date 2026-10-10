import { describe, expect, test } from "bun:test";

import type { PresetModelProtocol } from "@mosoo/contracts/models";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, ProjectId, VendorCredentialId } from "@mosoo/id";
import {
  VENDOR_ANTHROPIC,
  VENDOR_GEMINI,
  VENDOR_KIMI,
  VENDOR_MINIMAX,
  VENDOR_QWEN,
  VENDOR_ZHIPU,
} from "@mosoo/runtime-catalog";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";

import type { DriverVendorCredentialProfile } from "../src/modules/runtime/domain/driver-snapshot";
import { verifyRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import { sanitizeRuntimeVendorEnvVars } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-vendor-env-policy";
import { buildVendorProxyEnvVars } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-vendor-proxy-env.builder";

const BINDINGS = { RUNTIME_ACTION_TOKEN_SECRET: "test-runtime-action-token" };
const DRIVER_GENERATION = 3;
const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>(
  "01J0000000000000000000000F",
  "driver instance ID",
);
const PROJECT_ID = parsePlatformId<ProjectId>("01J0000000000000000000000Q", "project ID");
const CREDENTIAL_ID = parsePlatformId<VendorCredentialId>(
  "01J0000000000000000000000B",
  "credential ID",
);
const REQUEST_URL = "https://api.example.com/api/agents/run?probe=1";
const PROXY_URL = `https://api.example.com/api/driver/llm/proxy/${CREDENTIAL_ID}`;

function vendorCredential(
  overrides: Partial<DriverVendorCredentialProfile> & { vendorId: string },
): DriverVendorCredentialProfile {
  return {
    apiBase: null,
    projectId: PROJECT_ID,
    credentialId: CREDENTIAL_ID,
    models: null,
    ...overrides,
  };
}

async function expectLlmProxyGrant(
  grant: string | undefined,
  modelBinding: {
    imageModelId?: string;
    modelId: string;
    modelProtocol:
      | "anthropic-messages"
      | "google-gemini"
      | "openai-responses"
      | "openai-chat-completions";
  },
): Promise<void> {
  expect(grant).toBeDefined();
  const payload = await verifyRuntimeActionToken(BINDINGS, grant ?? "");
  expect(payload).toMatchObject({
    action: "llm_proxy",
    projectId: PROJECT_ID,
    driverGeneration: DRIVER_GENERATION,
    driverInstanceId: DRIVER_INSTANCE_ID,
    ...modelBinding,
    resourceId: CREDENTIAL_ID,
  });
}

function parseOpenCodeConfig(envVars: Record<string, string>): Record<string, unknown> {
  return JSON.parse(envVars["OPENCODE_CONFIG_CONTENT"] ?? "{}") as Record<string, unknown>;
}

describe("runtime vendor proxy env vars", () => {
  test("removes every runtime-managed provider variable before sandbox setup", () => {
    expect(
      sanitizeRuntimeVendorEnvVars({
        ANTHROPIC_API_KEY: "raw-anthropic-key",
        EXISTING_ENV: "kept",
        OPENAI_BASE_URL: "https://attacker.example.com/v1",
        OPENCODE_CONFIG_CONTENT: '{"provider":{"openai":{"options":{"apiKey":"raw"}}}}',
        MOSOO_PI_CONFIG_CONTENT:
          '{"baseUrl":"https://attacker.example.com","modelProtocol":"openai-responses"}',
        MOSOO_PI_PROXY_GRANT: "untrusted-grant",
      }),
    ).toEqual({ EXISTING_ENV: "kept" });
  });

  test("configures Pi with the proxy connection and a grant bound to the selected custom model", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "openai-compatible/vendor/custom-model",
        runtimeId: "pi",
        vendorCredential: vendorCredential({
          apiBase: "https://gateway.example.com/v1",
          models: ["vendor/custom-model", "other-model"],
          vendorId: "openai-compatible",
        }),
      },
      requestUrl: REQUEST_URL,
    });

    expect(Object.keys(envVars).toSorted()).toEqual([
      "MOSOO_PI_CONFIG_CONTENT",
      "MOSOO_PI_PROXY_GRANT",
    ]);
    expect(JSON.parse(envVars["MOSOO_PI_CONFIG_CONTENT"] ?? "{}")).toEqual({
      baseUrl: PROXY_URL,
      modelProtocol: "openai-chat-completions",
    });
    await expectLlmProxyGrant(envVars["MOSOO_PI_PROXY_GRANT"], {
      modelId: "vendor/custom-model",
      modelProtocol: "openai-chat-completions",
    });
  });

  test("rejects custom Pi credentials without an endpoint", async () => {
    await expect(
      buildVendorProxyEnvVars({
        bindings: BINDINGS,
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
        profile: {
          model: "custom-model",
          runtimeId: "pi",
          vendorCredential: vendorCredential({ vendorId: "openai-compatible" }),
        },
        requestUrl: REQUEST_URL,
      }),
    ).rejects.toThrow("Custom providers require an endpoint.");
  });

  test.each([
    ["openai-chat-completions", "@ai-sdk/openai-compatible"],
    ["openai-responses", "@ai-sdk/openai"],
    ["anthropic-messages", "@ai-sdk/anthropic"],
    ["google-gemini", "@ai-sdk/google"],
  ] as const)(
    "binds Pi and OpenCode custom %s to the same protocol",
    async (modelProtocol, npm) => {
      for (const runtimeId of ["pi", "acp-fallback"] as const) {
        const env = await buildVendorProxyEnvVars({
          bindings: BINDINGS,
          driverGeneration: DRIVER_GENERATION,
          driverInstanceId: DRIVER_INSTANCE_ID,
          profile: {
            model: "openai-compatible/custom-model",
            modelProtocol,
            runtimeId,
            vendorCredential: vendorCredential({
              apiBase: "https://models.example.com/v1",
              modelProtocol,
              vendorId: "openai-compatible",
            }),
          },
          requestUrl: REQUEST_URL,
        });
        if (runtimeId === "pi") {
          expect(JSON.parse(env["MOSOO_PI_CONFIG_CONTENT"] ?? "{}")).toEqual({
            baseUrl: PROXY_URL,
            modelProtocol,
          });
          await expectLlmProxyGrant(env["MOSOO_PI_PROXY_GRANT"], {
            modelId: "custom-model",
            modelProtocol,
          });
        } else {
          expect(parseOpenCodeConfig(env)).toMatchObject({
            provider: { "openai-compatible": { npm, options: { baseURL: PROXY_URL } } },
          });
          await expectLlmProxyGrant(env["OPENAI_COMPATIBLE_API_KEY"], {
            modelId: "custom-model",
            modelProtocol,
          });
        }
      }
    },
  );

  test.each([
    { vendorId: "openai", model: "gpt-5.4", modelProtocol: "openai-responses" },
    {
      vendorId: "anthropic",
      model: "claude-sonnet-5",
      modelProtocol: "anthropic-messages",
    },
    {
      vendorId: "deepseek",
      model: "deepseek-v4-pro",
      modelProtocol: "openai-chat-completions",
    },
    {
      vendorId: "gemini",
      model: "gemini-3.5-flash",
      modelProtocol: "openai-chat-completions",
    },
    {
      vendorId: "kimi",
      model: "kimi-k2.7-code",
      modelProtocol: "openai-chat-completions",
    },
    {
      vendorId: "zhipu",
      model: "glm-4.7",
      modelProtocol: "openai-chat-completions",
    },
    {
      vendorId: "minimax",
      model: "MiniMax-M3",
      modelProtocol: "anthropic-messages",
    },
    {
      vendorId: "qwen",
      model: "qwen3.7-plus",
      modelProtocol: "openai-chat-completions",
    },
    {
      vendorId: "opencode",
      model: "gemini-3.5-flash",
      modelProtocol: "google-gemini",
    },
  ] satisfies {
    vendorId: string;
    model: string;
    modelProtocol: PresetModelProtocol;
  }[])(
    "uses Pi preset $vendorId/$model's catalog protocol",
    async ({ vendorId, model, modelProtocol }) => {
      const env = await buildVendorProxyEnvVars({
        bindings: BINDINGS,
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
        profile: { model, runtimeId: "pi", vendorCredential: vendorCredential({ vendorId }) },
        requestUrl: REQUEST_URL,
      });
      await expectLlmProxyGrant(env["MOSOO_PI_PROXY_GRANT"], { modelId: model, modelProtocol });
      expect(JSON.parse(env["MOSOO_PI_CONFIG_CONTENT"] ?? "{}")).toEqual({
        baseUrl: PROXY_URL,
        modelProtocol,
      });
    },
  );

  test("rejects a credential protocol changed after the Session was frozen", async () => {
    await expect(
      buildVendorProxyEnvVars({
        bindings: BINDINGS,
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
        profile: {
          model: "custom-model",
          runtimeId: "pi",
          modelProtocol: "openai-responses",
          vendorCredential: vendorCredential({
            apiBase: "https://models.example.com/v1",
            vendorId: "openai-compatible",
            modelProtocol: "anthropic-messages",
          }),
        },
        requestUrl: REQUEST_URL,
      }),
    ).rejects.toThrow("differs from the frozen execution configuration");
  });

  test("injects a driver-bound proxy grant instead of the Anthropic API key", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "claude-sonnet-5",
        runtimeId: "claude-agent-sdk",
        vendorCredential: vendorCredential({ vendorId: "anthropic" }),
      },
      requestUrl: REQUEST_URL,
    });

    expect(envVars["ANTHROPIC_BASE_URL"]).toBe(PROXY_URL);
    await expectLlmProxyGrant(envVars["ANTHROPIC_API_KEY"], {
      modelId: "claude-sonnet-5",
      modelProtocol: "anthropic-messages",
    });
  });

  test("scopes official OpenAI runtime grants to the GPT Image model", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "gpt-5.4",
        runtimeId: "openai-runtime",
        vendorCredential: vendorCredential({ vendorId: "openai" }),
      },
      requestUrl: REQUEST_URL,
    });

    expect(envVars["OPENAI_BASE_URL"]).toBe(PROXY_URL);
    await expectLlmProxyGrant(envVars["OPENAI_API_KEY"], {
      imageModelId: "gpt-image-2",
      modelId: "gpt-5.4",
      modelProtocol: "openai-responses",
    });
  });

  test("keeps a custom Responses endpoint on the control plane for OpenAI runtime", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "gpt-custom",
        runtimeId: "openai-runtime",
        vendorCredential: vendorCredential({
          apiBase: "https://gateway.example.com/v1",
          models: ["gpt-custom"],
          vendorId: "openai-compatible",
        }),
      },
      requestUrl: REQUEST_URL,
    });

    // The stored custom endpoint stays behind the proxy; the sandbox only
    // ever sees the control-plane URL and the revocable grant.
    expect(envVars["OPENAI_COMPATIBLE_BASE_URL"]).toBe(PROXY_URL);
    await expectLlmProxyGrant(envVars["OPENAI_COMPATIBLE_API_KEY"], {
      modelId: "gpt-custom",
      modelProtocol: "openai-responses",
    });
  });

  test("accepts custom API base query semantics for control-plane forwarding", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "gpt-custom",
        runtimeId: "openai-runtime",
        vendorCredential: vendorCredential({
          apiBase: "https://gateway.example.com/v1?api-version=2026-07-01",
          models: ["gpt-custom"],
          vendorId: "openai-compatible",
        }),
      },
      requestUrl: REQUEST_URL,
    });

    await expectLlmProxyGrant(envVars["OPENAI_COMPATIBLE_API_KEY"], {
      modelId: "gpt-custom",
      modelProtocol: "openai-responses",
    });
  });

  test("rejects an unsupported runtime/provider before rendering proxy configuration", async () => {
    await expect(
      buildVendorProxyEnvVars({
        bindings: BINDINGS,
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
        profile: {
          model: "deepseek-v4-pro",
          runtimeId: "claude-agent-sdk",
          vendorCredential: vendorCredential({ vendorId: "opencode" }),
        },
        requestUrl: REQUEST_URL,
      }),
    ).rejects.toThrow("Runtime claude-agent-sdk does not support provider opencode.");
  });

  test("routes OpenCode Zen through the proxy for ACP fallback runtime", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "qwen3.6-plus",
        runtimeId: "acp-fallback",
        vendorCredential: vendorCredential({ vendorId: "opencode" }),
      },
      requestUrl: REQUEST_URL,
    });

    await expectLlmProxyGrant(envVars["OPENCODE_API_KEY"], {
      modelId: "qwen3.6-plus",
      modelProtocol: "anthropic-messages",
    });
    expect(parseOpenCodeConfig(envVars)).toMatchObject({
      enabled_providers: ["opencode"],
      model: "opencode/qwen3.6-plus",
      small_model: "opencode/qwen3.6-plus",
      provider: {
        opencode: {
          options: {
            apiKey: "{env:OPENCODE_API_KEY}",
            baseURL: PROXY_URL,
          },
        },
      },
    });
  });

  test("binds OpenCode Zen Gemini to its native Google protocol", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "gemini-3.5-flash",
        runtimeId: "acp-fallback",
        vendorCredential: vendorCredential({ vendorId: "opencode" }),
      },
      requestUrl: REQUEST_URL,
    });

    await expectLlmProxyGrant(envVars["OPENCODE_API_KEY"], {
      modelId: "gemini-3.5-flash",
      modelProtocol: "google-gemini",
    });
  });

  test("routes the OpenCode native DeepSeek provider through the proxy", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "deepseek-v4-pro",
        runtimeId: "acp-fallback",
        vendorCredential: vendorCredential({ vendorId: "deepseek" }),
      },
      requestUrl: REQUEST_URL,
    });

    await expectLlmProxyGrant(envVars["DEEPSEEK_API_KEY"], {
      modelId: "deepseek-v4-pro",
      modelProtocol: "openai-chat-completions",
    });
    expect(envVars["DEEPSEEK_BASE_URL"]).toBe(PROXY_URL);
    expect(parseOpenCodeConfig(envVars)).toMatchObject({
      enabled_providers: ["deepseek"],
      model: "deepseek/deepseek-v4-pro",
      small_model: "deepseek/deepseek-v4-pro",
      provider: {
        deepseek: {
          options: {
            apiKey: "{env:DEEPSEEK_API_KEY}",
            baseURL: PROXY_URL,
          },
        },
      },
    });
  });

  test("keeps the /v1 client segment for the OpenCode native Anthropic provider", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "claude-sonnet-5",
        runtimeId: "acp-fallback",
        vendorCredential: vendorCredential({ vendorId: VENDOR_ANTHROPIC.vendorId }),
      },
      requestUrl: REQUEST_URL,
    });

    expect(parseOpenCodeConfig(envVars)).toMatchObject({
      provider: {
        anthropic: {
          options: {
            apiKey: "{env:ANTHROPIC_API_KEY}",
            baseURL: `${PROXY_URL}/v1`,
          },
        },
      },
    });
  });

  test.each([
    {
      model: "gemini-3.5-flash",
      modelProtocol: "openai-chat-completions",
      name: "Gemini",
      npm: "@ai-sdk/openai-compatible",
      vendor: VENDOR_GEMINI,
    },
    {
      model: "qwen3.7-plus",
      modelProtocol: "openai-chat-completions",
      name: "Qwen",
      npm: "@ai-sdk/openai-compatible",
      vendor: VENDOR_QWEN,
    },
    {
      model: "kimi-k2.6",
      modelProtocol: "openai-chat-completions",
      name: "Kimi",
      npm: "@ai-sdk/openai-compatible",
      vendor: VENDOR_KIMI,
    },
    {
      openCodeProviderId: "zai",
      model: "glm-4.7",
      modelProtocol: "openai-chat-completions",
      name: "Zhipu",
      npm: "@ai-sdk/openai-compatible",
      vendor: VENDOR_ZHIPU,
    },
    {
      model: "MiniMax-M3",
      modelProtocol: "anthropic-messages",
      name: "MiniMax",
      npm: "@ai-sdk/anthropic",
      vendor: VENDOR_MINIMAX,
    },
  ])(
    "routes the OpenCode adapter provider for $name through the proxy",
    async ({ model, modelProtocol, name, npm, openCodeProviderId, vendor }) => {
      const typedVendor: RuntimeCatalogVendor = vendor;
      const providerId = openCodeProviderId ?? typedVendor.vendorId;
      const envVars = await buildVendorProxyEnvVars({
        bindings: BINDINGS,
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
        profile: {
          model,
          runtimeId: "acp-fallback",
          vendorCredential: vendorCredential({ vendorId: typedVendor.vendorId }),
        },
        requestUrl: REQUEST_URL,
      });

      await expectLlmProxyGrant(envVars[typedVendor.apiKeyEnvVar], {
        modelId: model,
        modelProtocol,
      });
      expect(parseOpenCodeConfig(envVars)).toMatchObject({
        enabled_providers: [providerId],
        model: `${providerId}/${model}`,
        small_model: `${providerId}/${model}`,
        provider: {
          [providerId]: {
            models: {
              [model]: {
                name: model,
              },
            },
            name,
            npm,
            options: {
              apiKey: `{env:${typedVendor.apiKeyEnvVar}}`,
              baseURL: PROXY_URL,
            },
          },
        },
      });
    },
  );

  test("rewrites mosoo Zhipu model prefix to OpenCode's Z.ai provider id", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "zhipu/glm-4.6",
        runtimeId: "acp-fallback",
        vendorCredential: vendorCredential({ vendorId: "zhipu" }),
      },
      requestUrl: REQUEST_URL,
    });

    expect(parseOpenCodeConfig(envVars)).toMatchObject({
      enabled_providers: ["zai"],
      model: "zai/glm-4.6",
      provider: {
        zai: {
          options: {
            apiKey: "{env:ZHIPU_API_KEY}",
            baseURL: PROXY_URL,
          },
        },
      },
      small_model: "zai/glm-4.6",
    });
  });

  test("routes an OpenCode custom provider through the proxy with declared models", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "deepseek-v4-flash",
        runtimeId: "acp-fallback",
        vendorCredential: vendorCredential({
          apiBase: "https://api.deepseek.com",
          models: ["deepseek-v4-flash"],
          vendorId: "openai-compatible",
        }),
      },
      requestUrl: REQUEST_URL,
    });

    expect(envVars["OPENAI_COMPATIBLE_BASE_URL"]).toBe(PROXY_URL);
    expect(parseOpenCodeConfig(envVars)).toMatchObject({
      enabled_providers: ["openai-compatible"],
      model: "openai-compatible/deepseek-v4-flash",
      small_model: "openai-compatible/deepseek-v4-flash",
      provider: {
        "openai-compatible": {
          models: {
            "deepseek-v4-flash": {
              name: "deepseek-v4-flash",
            },
          },
          name: "OpenAI Compatible",
          npm: "@ai-sdk/openai-compatible",
          options: {
            apiKey: "{env:OPENAI_COMPATIBLE_API_KEY}",
            baseURL: PROXY_URL,
          },
        },
      },
    });
  });

  test.each(["deepseek/deepseek-v4-flash", "openai-compatible/deepseek/deepseek-v4-flash"])(
    "keeps namespaced custom model %s on its credential provider",
    async (model) => {
      const envVars = await buildVendorProxyEnvVars({
        bindings: BINDINGS,
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
        profile: {
          model,
          runtimeId: "acp-fallback",
          vendorCredential: vendorCredential({
            apiBase: "https://models.example.com/v1",
            vendorId: "openai-compatible",
          }),
        },
        requestUrl: REQUEST_URL,
      });

      await expectLlmProxyGrant(envVars["OPENAI_COMPATIBLE_API_KEY"], {
        modelId: "deepseek/deepseek-v4-flash",
        modelProtocol: "openai-chat-completions",
      });
      expect(parseOpenCodeConfig(envVars)).toMatchObject({
        enabled_providers: ["openai-compatible"],
        model: "openai-compatible/deepseek/deepseek-v4-flash",
        small_model: "openai-compatible/deepseek/deepseek-v4-flash",
        provider: {
          "openai-compatible": {
            models: {
              "deepseek/deepseek-v4-flash": { name: "deepseek/deepseek-v4-flash" },
            },
          },
        },
      });
    },
  );

  test("declares the selected custom OpenCode model for an unrestricted credential", async () => {
    const envVars = await buildVendorProxyEnvVars({
      bindings: BINDINGS,
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
      profile: {
        model: "deepseek-v4-flash",
        runtimeId: "acp-fallback",
        vendorCredential: vendorCredential({
          apiBase: "https://api.deepseek.com",
          vendorId: "openai-compatible",
        }),
      },
      requestUrl: REQUEST_URL,
    });

    expect(parseOpenCodeConfig(envVars)).toMatchObject({
      enabled_providers: ["openai-compatible"],
      model: "openai-compatible/deepseek-v4-flash",
      provider: {
        "openai-compatible": {
          models: {
            "deepseek-v4-flash": {
              name: "deepseek-v4-flash",
            },
          },
        },
      },
    });
  });
});
