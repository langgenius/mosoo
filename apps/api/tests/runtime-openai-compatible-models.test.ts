import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { ProjectId } from "@mosoo/id";
import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import { resolveAvailableModels } from "../src/modules/vendor-credentials/application/available-models";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const PROJECT_ID = parsePlatformId<ProjectId>("01J00000000000000000000009", "project ID");

function createAvailableModelsDatabase(): D1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE organization (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE project (
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
      project_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      vendor_id TEXT NOT NULL
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
      api_base,
      api_key_secret_id,
      created_at,
      id,
      is_default,
      models,
      name,
      project_id,
      updated_at,
      vendor_id
    )
    VALUES (
      'https://models.example.com/v1',
      'secret-custom',
      1,
      'credential-custom',
      true,
      '["qwen-coder"]',
      'Custom default',
      '${PROJECT_ID}',
      1,
      '${VENDOR_OPENAI_COMPATIBLE.vendorId}'
    );
  `);

  return database;
}

describe("OpenAI-compatible runtime model support", () => {
  test("makes current custom models available for OpenAI app-server runtime", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      currentModelId: "qwen-coder",
      currentVendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      projectId: PROJECT_ID,
      runtimeId: "openai-runtime",
    });
    const currentCustomEntry = entries.find(
      (entry) =>
        entry.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId && entry.modelId === "qwen-coder",
    );

    expect(currentCustomEntry).toMatchObject({
      available: true,
      source: "custom",
      statusDetail: null,
      statusLabel: "Available",
    });
  });

  test("marks current custom models as wrong-runtime when the selected runtime rejects custom providers", async () => {
    const entries = await resolveAvailableModels(createAvailableModelsDatabase(), {
      currentModelId: "qwen-coder",
      currentVendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      projectId: PROJECT_ID,
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
      projectId: PROJECT_ID,
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
