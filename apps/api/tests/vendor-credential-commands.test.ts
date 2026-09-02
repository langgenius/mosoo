import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { ProjectId } from "@mosoo/id";
import {
  VENDOR_ANTHROPIC,
  VENDOR_DEEPSEEK,
  VENDOR_OPENAI,
  VENDOR_OPENAI_COMPATIBLE,
} from "@mosoo/runtime-catalog";

import {
  createVendorCredential,
  deleteVendorCredential,
  setDefaultVendorCredential,
  updateVendorCredential,
} from "../src/modules/vendor-credentials/application/vendor-credential-commands";
import { createApiTestFixture, insertTestVendorCredential } from "./helpers/api-test-fixture";

const OTHER_PROJECT_ID = parsePlatformId<ProjectId>(
  "01J000000000000000000000C9",
  "other project ID",
);
const OTHER_ACCOUNT_ID = "01J000000000000000000000CA";

async function insertOtherProject(
  fixture: Awaited<ReturnType<typeof createApiTestFixture>>,
  input: { ownerAccountId?: string } = {},
) {
  await fixture.database
    .prepare(
      `INSERT INTO project (
        created_at,
        id,
        name,
        organization_id,
        owner_account_id,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      OTHER_PROJECT_ID,
      "Other Project",
      fixture.ids.organizationId,
      input.ownerAccountId ?? fixture.viewer.id,
      1,
    )
    .run();
}

describe("vendor credential commands", () => {
  test("rejects public HTTP custom API bases before storing a credential", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      createVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: "http://api.example.com/v1",
        apiKey: "sk-create",
        models: ["custom-model"],
        name: "Unsafe custom provider",
        projectId: fixture.ids.projectId,
        vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      }),
    ).rejects.toThrow("Custom endpoint must use HTTPS.");

    const credentialCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vendor_credential")
      .first<{ count: number }>();
    const secretCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vault_secret")
      .first<{ count: number }>();
    expect(credentialCount?.count).toBe(0);
    expect(secretCount?.count).toBe(0);
  });

  test("rejects preset provider API bases that target another preset provider", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      createVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: VENDOR_ANTHROPIC.defaultApiBase,
        apiKey: "sk-create",
        name: "OpenAI pointed at Anthropic",
        projectId: fixture.ids.projectId,
        vendorId: VENDOR_OPENAI.vendorId,
      }),
    ).rejects.toThrow("Custom endpoint for openai cannot target Anthropic.");

    const credentialCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vendor_credential")
      .first<{ count: number }>();
    const secretCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vault_secret")
      .first<{ count: number }>();
    expect(credentialCount?.count).toBe(0);
    expect(secretCount?.count).toBe(0);

    await expect(
      createVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: VENDOR_DEEPSEEK.defaultApiBase,
        apiKey: "sk-create",
        name: "OpenAI pointed at DeepSeek",
        projectId: fixture.ids.projectId,
        vendorId: VENDOR_OPENAI.vendorId,
      }),
    ).rejects.toThrow("Custom endpoint for openai cannot target DeepSeek.");

    const finalCredentialCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vendor_credential")
      .first<{ count: number }>();
    const finalSecretCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vault_secret")
      .first<{ count: number }>();
    expect(finalCredentialCount?.count).toBe(0);
    expect(finalSecretCount?.count).toBe(0);
  });

  test("allows OpenAI-compatible credentials to target DeepSeek-compatible endpoints", async () => {
    const fixture = await createApiTestFixture();

    const credential = await createVendorCredential(fixture.bindings, fixture.viewer, {
      apiBase: VENDOR_DEEPSEEK.defaultApiBase,
      apiKey: "sk-create",
      models: ["deepseek-chat"],
      name: "DeepSeek custom gateway",
      projectId: fixture.ids.projectId,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    expect(credential).toMatchObject({
      apiBase: VENDOR_DEEPSEEK.defaultApiBase,
      isDefault: true,
      maskedApiKey: expect.any(String),
      models: ["deepseek-chat"],
      name: "DeepSeek custom gateway",
      projectId: fixture.ids.projectId,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    const row = await fixture.database
      .prepare(
        "SELECT api_base AS apiBase, models AS modelsJson, vendor_id AS vendorId FROM vendor_credential WHERE id = ?",
      )
      .bind(credential.id)
      .first<{ apiBase: string; modelsJson: string; vendorId: string }>();
    const secretCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vault_secret")
      .first<{ count: number }>();

    expect(row).toEqual({
      apiBase: VENDOR_DEEPSEEK.defaultApiBase,
      modelsJson: JSON.stringify(["deepseek-chat"]),
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });
    expect(secretCount?.count).toBe(1);
  });

  test("rejects trailing-dot localhost API bases before storing a credential", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      createVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: "https://localhost./v1",
        apiKey: "sk-create",
        models: ["custom-model"],
        name: "Unsafe custom provider",
        projectId: fixture.ids.projectId,
        vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      }),
    ).rejects.toThrow(
      "Custom endpoint cannot target local, private, metadata, or credential-bearing URLs.",
    );

    const credentialCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vendor_credential")
      .first<{ count: number }>();
    const secretCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vault_secret")
      .first<{ count: number }>();
    expect(credentialCount?.count).toBe(0);
    expect(secretCount?.count).toBe(0);
  });

  test("rejects private custom API bases before updating a credential", async () => {
    const fixture = await createApiTestFixture();
    const credentialId = "01J000000000000000000000C2";
    await insertTestVendorCredential(fixture, {
      apiBase: "https://api.example.com/v1",
      credentialId,
      models: ["custom-model"],
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    await expect(
      updateVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: "http://10.0.0.2/v1",
        id: credentialId,
        projectId: fixture.ids.projectId,
      }),
    ).rejects.toThrow(
      "Custom endpoint cannot target local, private, metadata, or credential-bearing URLs.",
    );

    const row = await fixture.database
      .prepare("SELECT api_base AS apiBase FROM vendor_credential WHERE id = ?")
      .bind(credentialId)
      .first<{ apiBase: string }>();
    const secretCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vault_secret")
      .first<{ count: number }>();
    expect(row?.apiBase).toBe("https://api.example.com/v1");
    expect(secretCount?.count).toBe(1);
  });

  test("rejects cross-provider API bases before updating a preset provider credential", async () => {
    const fixture = await createApiTestFixture();
    const credentialId = "01J000000000000000000000C3";
    await insertTestVendorCredential(fixture, {
      credentialId,
      vendorId: VENDOR_OPENAI.vendorId,
    });

    await expect(
      updateVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: VENDOR_ANTHROPIC.defaultApiBase,
        id: credentialId,
        projectId: fixture.ids.projectId,
      }),
    ).rejects.toThrow("Custom endpoint for openai cannot target Anthropic.");

    const row = await fixture.database
      .prepare("SELECT api_base AS apiBase FROM vendor_credential WHERE id = ?")
      .bind(credentialId)
      .first<{ apiBase: string | null }>();
    expect(row?.apiBase).toBeNull();
  });

  test("rejects update when the credential is not in the requested Project", async () => {
    const fixture = await createApiTestFixture();
    await insertOtherProject(fixture);
    const credentialId = "01J000000000000000000000C4";
    await insertTestVendorCredential(fixture, {
      credentialId,
      vendorId: VENDOR_OPENAI.vendorId,
    });

    await expect(
      updateVendorCredential(fixture.bindings, fixture.viewer, {
        id: credentialId,
        name: "Should not update",
        projectId: OTHER_PROJECT_ID,
      }),
    ).rejects.toThrow("Vendor credential not found.");

    const row = await fixture.database
      .prepare("SELECT name FROM vendor_credential WHERE id = ?")
      .bind(credentialId)
      .first<{ name: string }>();
    expect(row?.name).not.toBe("Should not update");
  });

  test("rejects delete when the credential is not in the requested Project", async () => {
    const fixture = await createApiTestFixture();
    await insertOtherProject(fixture);
    const credentialId = "01J000000000000000000000C5";
    await insertTestVendorCredential(fixture, {
      credentialId,
      vendorId: VENDOR_OPENAI.vendorId,
    });

    await expect(
      deleteVendorCredential(fixture.bindings, fixture.viewer, {
        id: credentialId,
        projectId: OTHER_PROJECT_ID,
      }),
    ).rejects.toThrow("Vendor credential not found.");

    const credentialCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vendor_credential WHERE id = ?")
      .bind(credentialId)
      .first<{ count: number }>();
    const secretCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vault_secret")
      .first<{ count: number }>();
    expect(credentialCount?.count).toBe(1);
    expect(secretCount?.count).toBe(1);
  });

  test("rejects update before row lookup when the requested Project is not owned", async () => {
    const fixture = await createApiTestFixture();
    await insertOtherProject(fixture, { ownerAccountId: OTHER_ACCOUNT_ID });
    const credentialId = "01J000000000000000000000C6";
    await insertTestVendorCredential(fixture, {
      credentialId,
      vendorId: VENDOR_OPENAI.vendorId,
    });

    await expect(
      updateVendorCredential(fixture.bindings, fixture.viewer, {
        id: credentialId,
        name: "Should not update",
        projectId: OTHER_PROJECT_ID,
      }),
    ).rejects.toThrow("permission");

    const row = await fixture.database
      .prepare("SELECT name FROM vendor_credential WHERE id = ?")
      .bind(credentialId)
      .first<{ name: string }>();
    expect(row?.name).not.toBe("Should not update");
  });

  test("rejects delete before row lookup when the requested Project is not owned", async () => {
    const fixture = await createApiTestFixture();
    await insertOtherProject(fixture, { ownerAccountId: OTHER_ACCOUNT_ID });
    const credentialId = "01J000000000000000000000C7";
    await insertTestVendorCredential(fixture, {
      credentialId,
      vendorId: VENDOR_OPENAI.vendorId,
    });

    await expect(
      deleteVendorCredential(fixture.bindings, fixture.viewer, {
        id: credentialId,
        projectId: OTHER_PROJECT_ID,
      }),
    ).rejects.toThrow("permission");

    const credentialCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vendor_credential WHERE id = ?")
      .bind(credentialId)
      .first<{ count: number }>();
    const secretCount = await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM vault_secret")
      .first<{ count: number }>();
    expect(credentialCount?.count).toBe(1);
    expect(secretCount?.count).toBe(1);
  });
});

describe("vendor credential default selection", () => {
  async function readIsDefault(
    fixture: Awaited<ReturnType<typeof createApiTestFixture>>,
    id: string,
  ): Promise<number | undefined> {
    const row = await fixture.database
      .prepare("SELECT is_default AS isDefault FROM vendor_credential WHERE id = ?")
      .bind(id)
      .first<{ isDefault: number }>();

    return row?.isDefault;
  }

  async function createAnthropicKey(
    fixture: Awaited<ReturnType<typeof createApiTestFixture>>,
    name: string,
  ) {
    return createVendorCredential(fixture.bindings, fixture.viewer, {
      apiKey: `sk-${name}`,
      name,
      projectId: fixture.ids.projectId,
      vendorId: VENDOR_ANTHROPIC.vendorId,
    });
  }

  test("marks the first credential for a vendor as default and later ones non-default", async () => {
    const fixture = await createApiTestFixture();
    const first = await createAnthropicKey(fixture, "A");
    const second = await createAnthropicKey(fixture, "B");

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
  });

  test("setDefaultVendorCredential moves the default to the chosen credential", async () => {
    const fixture = await createApiTestFixture();
    const first = await createAnthropicKey(fixture, "A");
    const second = await createAnthropicKey(fixture, "B");

    const promoted = await setDefaultVendorCredential(fixture.bindings, fixture.viewer, {
      id: second.id,
      projectId: fixture.ids.projectId,
    });

    expect(promoted.isDefault).toBe(true);
    expect(await readIsDefault(fixture, first.id)).toBe(0);
    expect(await readIsDefault(fixture, second.id)).toBe(1);
  });

  test("deleting the default promotes the next remaining credential", async () => {
    const fixture = await createApiTestFixture();
    const first = await createAnthropicKey(fixture, "A");
    const second = await createAnthropicKey(fixture, "B");

    await deleteVendorCredential(fixture.bindings, fixture.viewer, {
      id: first.id,
      projectId: fixture.ids.projectId,
    });

    expect(await readIsDefault(fixture, second.id)).toBe(1);
  });

  test("keeps the existing default when a non-default credential is deleted", async () => {
    const fixture = await createApiTestFixture();
    const first = await createAnthropicKey(fixture, "A");
    const second = await createAnthropicKey(fixture, "B");

    await deleteVendorCredential(fixture.bindings, fixture.viewer, {
      id: second.id,
      projectId: fixture.ids.projectId,
    });

    expect(await readIsDefault(fixture, first.id)).toBe(1);
  });
});
