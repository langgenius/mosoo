import { describe, expect, test } from "bun:test";

import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import { resolveAvailableModels } from "../src/modules/vendor-credentials/application/available-models";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createAvailableModelsDatabase(): D1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE organization (
      id TEXT PRIMARY KEY,
      byok_allowed_providers TEXT,
      byok_enabled INTEGER NOT NULL
    );

    CREATE TABLE vendor_credential (
      api_base TEXT,
      api_key_secret_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_preferred INTEGER NOT NULL DEFAULT 0,
      models TEXT,
      name TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      owner_account_id TEXT,
      updated_at INTEGER NOT NULL,
      vendor_id TEXT NOT NULL
    );

    INSERT INTO organization (id, byok_allowed_providers, byok_enabled)
    VALUES ('01J00000000000000000000006', NULL, 1);
  `);

  return database;
}

describe("OpenAI-compatible runtime model support", () => {
  test("marks current custom models as wrong-runtime when the selected runtime rejects custom providers", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      accountId: "account-1",
      currentModelId: "qwen-coder",
      currentVendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      organizationId: "01J00000000000000000000006",
      runtimeId: "claude-agent-sdk",
    });
    const currentCustomEntry = entries.find(
      (entry) =>
        entry.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId && entry.modelId === "qwen-coder",
    );

    expect(currentCustomEntry).toMatchObject({
      available: false,
      reason: "wrong-runtime",
    });
  });

  test("keeps unsupported preset models visible with wrong-runtime reason", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      accountId: "account-1",
      organizationId: "01J00000000000000000000006",
      runtimeId: "openai-runtime",
    });
    const claudeEntry = entries.find(
      (entry) => entry.vendorId === "anthropic" && entry.modelId === "claude-sonnet-4-5",
    );

    expect(claudeEntry).toMatchObject({
      available: false,
      reason: "wrong-runtime",
    });
  });
});
