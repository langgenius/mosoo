import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AppId } from "@mosoo/id";
import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import { resolveAvailableModels } from "../src/modules/vendor-credentials/application/available-models";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const APP_ID = parsePlatformId<AppId>("01J00000000000000000000009", "app ID");

function createAvailableModelsDatabase(): D1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE organization (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE app (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT NOT NULL,
      owner_account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      default_environment_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE vendor_credential (
      api_base TEXT,
      api_key_secret_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      id TEXT PRIMARY KEY,
      is_default INTEGER DEFAULT false NOT NULL,
      models TEXT,
      name TEXT NOT NULL,
      app_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      vendor_id TEXT NOT NULL
    );

    INSERT INTO organization (id) VALUES ('01J00000000000000000000006');

    INSERT INTO app (
      id,
      organization_id,
      owner_account_id,
      name,
      default_environment_id,
      created_at,
      updated_at
    )
    VALUES (
      '${APP_ID}',
      '01J00000000000000000000006',
      'account-1',
      'Default App',
      NULL,
      1,
      1
    );
  `);

  return database;
}

describe("OpenAI-compatible runtime model support", () => {
  test("marks current custom models as wrong-runtime for OpenAI app-server runtime", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      currentModelId: "qwen-coder",
      currentVendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      appId: APP_ID,
      runtimeId: "openai-runtime",
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

  test("marks current custom models as wrong-runtime when the selected runtime rejects custom providers", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      currentModelId: "qwen-coder",
      currentVendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      appId: APP_ID,
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
      appId: APP_ID,
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
