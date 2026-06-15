import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AppId } from "@mosoo/id";

import { resolveAvailableModels } from "../src/modules/vendor-credentials/application/available-models";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const APP_ID = parsePlatformId<AppId>("01J00000000000000000000009", "app ID");

function createAvailableModelsDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE vendor_credential (
      id text PRIMARY KEY NOT NULL,
      app_id text NOT NULL,
      vendor_id text NOT NULL,
      name text NOT NULL,
      api_key_secret_id text NOT NULL,
      api_base text,
      models text
    );

    INSERT INTO organization (id) VALUES ('01J00000000000000000000006');

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      slug,
      default_environment_id,
      created_at,
      updated_at
    )
    VALUES (
      '${APP_ID}',
      '01J00000000000000000000006',
      'account-1',
      'Default App',
      'default',
      NULL,
      1,
      1
    );

    INSERT INTO vendor_credential (
      id,
      app_id,
      vendor_id,
      name,
      api_key_secret_id,
      api_base,
      models
    )
    VALUES (
      'credential-1',
      '${APP_ID}',
      'openai',
      'OpenAI default',
      'secret-1',
      NULL,
      NULL
    ),
    (
      'credential-custom',
      '${APP_ID}',
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
  test("resolves preset and custom availability", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      appId: APP_ID,
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
      appId: APP_ID,
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

  test("apps a missing current preset model as unavailable catalog state", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      currentModelId: "legacy-gpt",
      currentVendorId: "openai",
      appId: APP_ID,
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

  test("apps missing current custom models through runtime availability", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      currentModelId: "removed-custom-model",
      currentVendorId: "openai-compatible",
      appId: APP_ID,
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
