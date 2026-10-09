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
      model_protocol text,
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
  test("makes configured preset and declared custom models available for Pi", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      projectId: PROJECT_ID,
      runtimeId: "pi",
    });

    expect(entries.filter((entry) => entry.available && entry.source === "custom")).toEqual([
      expect.objectContaining({
        modelId: "qwen-coder",
        modelProtocol: "openai-chat-completions",
        source: "custom",
        vendorId: "openai-compatible",
      }),
    ]);
    expect(entries.some((entry) => entry.modelId === "custom-model")).toBe(false);
    expect(entries.find((entry) => entry.vendorId === "openai")).toMatchObject({
      available: true,
      modelProtocol: "openai-responses",
    });
  });

  test("does not unlock Pi models from a custom credential without declared models", async () => {
    const database = createAvailableModelsDatabase();
    database.execute(
      "UPDATE vendor_credential SET models = NULL WHERE vendor_id = 'openai-compatible'",
    );

    const entries = await resolveAvailableModels(database, {
      currentModelId: "custom-model",
      currentVendorId: "openai-compatible",
      projectId: PROJECT_ID,
      runtimeId: "pi",
    });

    expect(entries.filter((entry) => entry.available && entry.source === "custom")).toEqual([]);
    expect(entries.find((entry) => entry.modelId === "custom-model")).toMatchObject({
      available: false,
      reason: "needs-key",
      source: "custom",
      vendorId: "openai-compatible",
    });
  });

  test("preserves Responses for legacy undeclared custom models on OpenAI runtime", async () => {
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
      modelProtocol: "openai-responses",
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

  test.each(["openai-chat-completions", "openai-responses", "anthropic-messages", "google-gemini"])(
    "uses the selected custom credential's %s declaration for every runtime",
    async (protocol) => {
      const database = createAvailableModelsDatabase();
      await database
        .prepare("UPDATE vendor_credential SET model_protocol = ? WHERE id = 'credential-custom'")
        .bind(protocol)
        .run();
      for (const runtimeId of ["pi", "acp-fallback", "openai-runtime"]) {
        const entries = await resolveAvailableModels(database, {
          projectId: PROJECT_ID,
          runtimeId,
        });
        const entry = entries.find((model) => model.modelId === "qwen-coder");
        if (runtimeId === "openai-runtime" && protocol !== "openai-responses") {
          expect(entry).toMatchObject({
            available: false,
            reason: "wrong-protocol",
            statusDetail: `Runtime openai-runtime does not support model protocol ${protocol}.`,
          });
        } else {
          expect(entry).toMatchObject({ available: true, modelProtocol: protocol });
        }
      }
    },
  );

  test("does not skip the first name/id credential to find a compatible duplicate model", async () => {
    const database = createAvailableModelsDatabase();
    database.execute(`
      UPDATE vendor_credential SET model_protocol = 'openai-chat-completions'
      WHERE id = 'credential-custom';
      INSERT INTO vendor_credential (
        id, project_id, vendor_id, name, api_key_secret_id, api_base, models, model_protocol
      ) VALUES (
        'credential-z', '${PROJECT_ID}', 'openai-compatible', 'Custom default',
        'secret-z', 'https://responses.example.com/v1', '["qwen-coder"]', 'openai-responses'
      );
    `);
    const entries = await resolveAvailableModels(database, {
      projectId: PROJECT_ID,
      runtimeId: "openai-runtime",
    });
    expect(entries.filter((entry) => entry.modelId === "qwen-coder")).toEqual([
      expect.objectContaining({ available: false, reason: "wrong-protocol" }),
    ]);
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
