import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { ProjectId } from "@mosoo/id";

import { resolveAvailableModels } from "../src/modules/vendor-credentials/application/available-models";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const PROJECT_ID = parsePlatformId<ProjectId>("01J00000000000000000000009", "project ID");

function createAvailableModelsDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE vendor_credential (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      vendor_id text NOT NULL,
      name text NOT NULL,
      api_key_secret_id text NOT NULL,
      api_base text,
      is_default integer DEFAULT false NOT NULL,
      models text
    );

    INSERT INTO organization (id) VALUES ('01J00000000000000000000006');

    INSERT INTO project (
      id,
      organization_id,
      owner_account_id,
      name,
      default_environment_id,
      created_at,
      updated_at
    )
    VALUES (
      '${PROJECT_ID}',
      '01J00000000000000000000006',
      'account-1',
      'Default Project',
      NULL,
      1,
      1
    );

    INSERT INTO vendor_credential (
      id,
      project_id,
      vendor_id,
      name,
      api_key_secret_id,
      api_base,
      models
    )
    VALUES (
      'credential-1',
      '${PROJECT_ID}',
      'openai',
      'OpenAI default',
      'secret-1',
      NULL,
      NULL
    ),
    (
      'credential-opencode',
      '${PROJECT_ID}',
      'opencode',
      'OpenCode Zen default',
      'secret-opencode',
      NULL,
      NULL
    ),
    (
      'credential-deepseek',
      '${PROJECT_ID}',
      'deepseek',
      'DeepSeek default',
      'secret-deepseek',
      NULL,
      NULL
    ),
    (
      'credential-gemini',
      '${PROJECT_ID}',
      'gemini',
      'Gemini default',
      'secret-gemini',
      NULL,
      NULL
    ),
    (
      'credential-zhipu',
      '${PROJECT_ID}',
      'zhipu',
      'Zhipu default',
      'secret-zhipu',
      NULL,
      NULL
    ),
    (
      'credential-custom',
      '${PROJECT_ID}',
      'openai-compatible',
      'Custom default',
      'secret-custom',
      'https://models.example.com/v1',
      '["qwen-coder"]'
    );
  `);

  return database;
}

describe("available models", () => {
  test("makes custom models available for OpenAI runtime", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      projectId: PROJECT_ID,
      runtimeId: "openai-runtime",
    });

    expect(
      entries.filter((entry) => entry.vendorId === "openai").every((entry) => entry.available),
    ).toBe(true);
    expect(
      entries.find(
        (entry) => entry.vendorId === "openai-compatible" && entry.modelId === "qwen-coder",
      ),
    ).toMatchObject({
      available: true,
      source: "custom",
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(entries.find((entry) => entry.vendorId === "anthropic")).toMatchObject({
      available: false,
      reason: "wrong-runtime",
      statusDetail: "Anthropic is not available for OpenAI Runtime.",
      statusLabel: "Not available",
    });
  });

  test("makes OpenAI preset models available for the internal System Agent runtime", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      projectId: PROJECT_ID,
      runtimeId: "system-agent",
    });

    expect(
      entries.find((entry) => entry.vendorId === "openai" && entry.modelId === "gpt-5.4"),
    ).toMatchObject({
      available: true,
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(entries.find((entry) => entry.vendorId === "anthropic")).toMatchObject({
      available: false,
      reason: "wrong-runtime",
      statusDetail: "Anthropic is not available for System Agent.",
      statusLabel: "Not available",
    });
  });

  test("makes OpenCode runtime models available through their owning providers", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      projectId: PROJECT_ID,
      runtimeId: "acp-fallback",
    });

    expect(
      entries.find((entry) => entry.vendorId === "deepseek" && entry.modelId === "deepseek-v4-pro"),
    ).toMatchObject({
      available: true,
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(
      entries.find((entry) => entry.vendorId === "gemini" && entry.modelId === "gemini-3.5-flash"),
    ).toMatchObject({
      available: true,
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(
      entries.find((entry) => entry.vendorId === "zhipu" && entry.modelId === "glm-4.7"),
    ).toMatchObject({
      available: true,
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(
      entries.find((entry) => entry.vendorId === "opencode" && entry.modelId === "qwen3.6-plus"),
    ).toMatchObject({
      available: true,
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(
      entries.find((entry) => entry.vendorId === "opencode" && entry.modelId === "glm-5.2"),
    ).toMatchObject({
      available: true,
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(
      entries.find((entry) => entry.vendorId === "opencode" && entry.modelId === "minimax-m2.7"),
    ).toMatchObject({
      available: true,
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(
      entries.find(
        (entry) => entry.vendorId === "opencode" && entry.modelId === "gemini-3.5-flash",
      ),
    ).toMatchObject({
      available: true,
      statusDetail: null,
      statusLabel: "Available",
    });
    expect(
      entries
        .filter((entry) => entry.modelId === "gemini-3.5-flash")
        .map((entry) => ({
          available: entry.available,
          vendorId: entry.vendorId,
        })),
    ).toContainEqual({
      available: true,
      vendorId: "gemini",
    });
    expect(
      entries
        .filter((entry) => entry.modelId === "gemini-3.5-flash")
        .map((entry) => ({
          available: entry.available,
          vendorId: entry.vendorId,
        })),
    ).toContainEqual({
      available: true,
      vendorId: "opencode",
    });
    expect(
      entries.find(
        (entry) => entry.vendorId === "openai-compatible" && entry.modelId === "qwen-coder",
      ),
    ).toMatchObject({
      available: true,
      source: "custom",
      statusDetail: null,
      statusLabel: "Available",
    });
  });

  test("projects a missing current preset model as unavailable catalog state", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      currentModelId: "legacy-gpt",
      currentVendorId: "openai",
      projectId: PROJECT_ID,
      runtimeId: "openai-runtime",
    });

    expect(
      entries.find((entry) => entry.vendorId === "openai" && entry.modelId === "legacy-gpt"),
    ).toMatchObject({
      available: false,
      displayName: "legacy-gpt",
      reason: "unknown-model",
      source: "preset",
      statusDetail: "Model legacy-gpt is not in the runtime catalog.",
      statusLabel: "Unknown model",
      vendorLabel: "OpenAI",
    });
  });

  test("marks a missing current custom model as needing a key for OpenAI runtime", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      currentModelId: "removed-custom-model",
      currentVendorId: "openai-compatible",
      projectId: PROJECT_ID,
      runtimeId: "openai-runtime",
    });

    expect(
      entries.find(
        (entry) =>
          entry.vendorId === "openai-compatible" && entry.modelId === "removed-custom-model",
      ),
    ).toMatchObject({
      available: false,
      reason: "needs-key",
      source: "custom",
      statusDetail: "Configure a Provider key for Custom Provider.",
      statusLabel: "Provider key required",
    });
  });
});
