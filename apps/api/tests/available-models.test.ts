import { describe, expect, test } from "bun:test";

import { resolveAvailableModels } from "../src/modules/vendor-credentials/application/available-models";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createAvailableModelsDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE vendor_credential (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      vendor_id text NOT NULL,
      owner_account_id text,
      name text NOT NULL,
      api_key_secret_id text NOT NULL,
      api_base text,
      models text,
      is_default integer DEFAULT 0 NOT NULL,
      is_preferred integer DEFAULT 0 NOT NULL
    );

    INSERT INTO organization (id) VALUES ('01J00000000000000000000006');

    INSERT INTO vendor_credential (
      id,
      organization_id,
      vendor_id,
      owner_account_id,
      name,
      api_key_secret_id,
      api_base,
      models,
      is_default,
      is_preferred
    )
    VALUES (
      'credential-1',
      '01J00000000000000000000006',
      'openai',
      NULL,
      'OpenAI default',
      'secret-1',
      NULL,
      NULL,
      1,
      0
    ),
    (
      'credential-custom',
      '01J00000000000000000000006',
      'openai-compatible',
      'account-1',
      'Custom default',
      'secret-custom',
      'https://models.example.com/v1',
      '["qwen-coder"]',
      0,
      1
    );
  `);

  return database;
}

describe("available models", () => {
  test("resolves preset and custom availability", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      accountId: "account-1",
      organizationId: "01J00000000000000000000006",
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
      accountId: "account-1",
      organizationId: "01J00000000000000000000006",
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

  test("projects a missing current preset model as unavailable catalog state", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      accountId: "account-1",
      currentModelId: "legacy-gpt",
      currentVendorId: "openai",
      organizationId: "01J00000000000000000000006",
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

  test("projects missing current custom models through runtime availability", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      accountId: "account-1",
      currentModelId: "removed-custom-model",
      currentVendorId: "openai-compatible",
      organizationId: "01J00000000000000000000006",
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
