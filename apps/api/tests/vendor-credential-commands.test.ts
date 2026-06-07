import { describe, expect, test } from "bun:test";

import { VENDOR_ANTHROPIC, VENDOR_OPENAI, VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import {
  createVendorCredential,
  updateVendorCredential,
} from "../src/modules/vendor-credentials/application/vendor-credential-commands";
import {
  createAgentBuilderApiFixture,
  insertAgentBuilderVendorCredential,
} from "./helpers/agent-builder-api-fixture";

describe("vendor credential commands", () => {
  test("rejects public HTTP custom API bases before storing a credential", async () => {
    const fixture = await createAgentBuilderApiFixture();

    await expect(
      createVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: "http://api.example.com/v1",
        apiKey: "sk-create",
        models: ["custom-model"],
        name: "Unsafe custom provider",
        organizationId: fixture.ids.organizationId,
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
    const fixture = await createAgentBuilderApiFixture();

    await expect(
      createVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: VENDOR_ANTHROPIC.defaultApiBase,
        apiKey: "sk-create",
        name: "OpenAI pointed at Anthropic",
        organizationId: fixture.ids.organizationId,
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
  });

  test("rejects trailing-dot localhost API bases before storing a credential", async () => {
    const fixture = await createAgentBuilderApiFixture();

    await expect(
      createVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: "https://localhost./v1",
        apiKey: "sk-create",
        models: ["custom-model"],
        name: "Unsafe custom provider",
        organizationId: fixture.ids.organizationId,
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
    const fixture = await createAgentBuilderApiFixture();
    const credentialId = "01J000000000000000000000C2";
    await insertAgentBuilderVendorCredential(fixture, {
      apiBase: "https://api.example.com/v1",
      credentialId,
      models: ["custom-model"],
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
    });

    await expect(
      updateVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: "http://10.0.0.2/v1",
        id: credentialId,
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
    const fixture = await createAgentBuilderApiFixture();
    const credentialId = "01J000000000000000000000C3";
    await insertAgentBuilderVendorCredential(fixture, {
      credentialId,
      vendorId: VENDOR_OPENAI.vendorId,
    });

    await expect(
      updateVendorCredential(fixture.bindings, fixture.viewer, {
        apiBase: VENDOR_ANTHROPIC.defaultApiBase,
        id: credentialId,
      }),
    ).rejects.toThrow("Custom endpoint for openai cannot target Anthropic.");

    const row = await fixture.database
      .prepare("SELECT api_base AS apiBase FROM vendor_credential WHERE id = ?")
      .bind(credentialId)
      .first<{ apiBase: string | null }>();
    expect(row?.apiBase).toBeNull();
  });
});
