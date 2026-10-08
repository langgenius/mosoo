import { describe, expect, test } from "bun:test";

import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type { ProjectId } from "@mosoo/id";
import { graphql } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import {
  createVendorCredential,
  updateVendorCredential,
} from "../src/modules/vendor-credentials/application/vendor-credential-commands";
import { listVendorCredentials } from "../src/modules/vendor-credentials/application/vendor-credential-list";
import {
  resolveVendorApiKey,
  resolveVendorCredentialRef,
} from "../src/modules/vendor-credentials/application/vendor-credential.secret-resolution";
import { createApiTestFixture, insertTestVendorCredential } from "./helpers/api-test-fixture";

const PROTOCOLS = [
  "anthropic-messages",
  "google-gemini",
  "openai-chat-completions",
  "openai-responses",
] as const satisfies readonly PresetModelProtocol[];

function customInput(projectId: ProjectId) {
  return {
    apiBase: "https://models.example.com/v1",
    apiKey: "test-provider-key",
    models: ["custom-model"],
    name: "Custom provider",
    projectId,
    vendorId: "openai-compatible",
  };
}

describe("vendor credential model protocol", () => {
  test.each(PROTOCOLS)(
    "round-trips %s through storage, listing and runtime resolution",
    async (modelProtocol) => {
      const fixture = await createApiTestFixture();
      const created = await createVendorCredential(fixture.bindings, fixture.viewer, {
        ...customInput(fixture.ids.projectId),
        modelProtocol,
      });
      expect(created.modelProtocol).toBe(modelProtocol);
      expect(
        await fixture.database
          .prepare("SELECT model_protocol FROM vendor_credential WHERE id = ?")
          .bind(created.id)
          .first("model_protocol"),
      ).toBe(modelProtocol);
      expect(
        (await listVendorCredentials(fixture.bindings, fixture.viewer, fixture.ids.projectId))[0]
          ?.modelProtocol,
      ).toBe(modelProtocol);
      const request = {
        bindings: fixture.bindings,
        executionOwnerUserId: fixture.viewer.id,
        options: { modelId: "custom-model" },
        projectId: fixture.ids.projectId,
        vendorId: "openai-compatible",
      };
      expect((await resolveVendorApiKey(request))?.modelProtocol).toBe(modelProtocol);
      const reference = await resolveVendorCredentialRef(request);
      expect(reference?.modelProtocol).toBe(modelProtocol);
      expect(reference).not.toHaveProperty("apiKey");
    },
  );

  test.each([undefined, null])(
    "new custom credentials with %s protocol store Chat Completions",
    async (modelProtocol) => {
      const fixture = await createApiTestFixture();
      const created = await createVendorCredential(fixture.bindings, fixture.viewer, {
        ...customInput(fixture.ids.projectId),
        modelProtocol,
      });
      expect(created.modelProtocol).toBe("openai-chat-completions");
      expect(
        await fixture.database
          .prepare("SELECT model_protocol FROM vendor_credential WHERE id = ?")
          .bind(created.id)
          .first("model_protocol"),
      ).toBe("openai-chat-completions");
    },
  );

  test("legacy null survives omitted and null updates, while explicit protocols cannot be cleared", async () => {
    const fixture = await createApiTestFixture();
    await insertTestVendorCredential(fixture, {
      apiBase: "https://models.example.com/v1",
      models: ["custom-model"],
      vendorId: "openai-compatible",
    });
    const [legacy] = await listVendorCredentials(
      fixture.bindings,
      fixture.viewer,
      fixture.ids.projectId,
    );
    expect(legacy?.modelProtocol).toBeNull();
    if (!legacy) throw new Error("Expected legacy credential");
    const input = { id: legacy.id, projectId: fixture.ids.projectId };
    expect(
      (
        await updateVendorCredential(fixture.bindings, fixture.viewer, {
          ...input,
          name: "Renamed",
        })
      ).modelProtocol,
    ).toBeNull();
    expect(
      (
        await updateVendorCredential(fixture.bindings, fixture.viewer, {
          ...input,
          modelProtocol: null,
        })
      ).modelProtocol,
    ).toBeNull();
    const reference = await resolveVendorCredentialRef({
      bindings: fixture.bindings,
      executionOwnerUserId: fixture.viewer.id,
      options: { modelId: "custom-model" },
      projectId: fixture.ids.projectId,
      vendorId: "openai-compatible",
    });
    expect(reference?.modelProtocol).toBeNull();
    expect(
      (
        await updateVendorCredential(fixture.bindings, fixture.viewer, {
          ...input,
          modelProtocol: "openai-responses",
        })
      ).modelProtocol,
    ).toBe("openai-responses");
    expect(
      (
        await updateVendorCredential(fixture.bindings, fixture.viewer, {
          ...input,
          name: "Renamed again",
        })
      ).modelProtocol,
    ).toBe("openai-responses");
    await expect(
      updateVendorCredential(fixture.bindings, fixture.viewer, {
        ...input,
        modelProtocol: null,
        apiKey: "replacement-key",
      }),
    ).rejects.toThrow("An explicit model protocol cannot be cleared.");
    expect(
      await fixture.database
        .prepare("SELECT model_protocol FROM vendor_credential WHERE id = ?")
        .bind(legacy.id)
        .first("model_protocol"),
    ).toBe("openai-responses");
    expect(
      await fixture.database.prepare("SELECT COUNT(*) AS count FROM vault_secret").first("count"),
    ).toBe(1);
  });

  test("preset credentials retain catalog protocol ownership on create and update", async () => {
    const fixture = await createApiTestFixture();
    const input = {
      apiKey: "preset-key",
      name: "OpenAI",
      projectId: fixture.ids.projectId,
      vendorId: "openai",
    };
    await expect(
      createVendorCredential(fixture.bindings, fixture.viewer, {
        ...input,
        modelProtocol: "openai-responses",
      }),
    ).rejects.toThrow("Preset provider credentials cannot declare a model protocol.");
    expect(
      await fixture.database.prepare("SELECT COUNT(*) AS count FROM vault_secret").first("count"),
    ).toBe(0);
    const created = await createVendorCredential(fixture.bindings, fixture.viewer, {
      ...input,
      modelProtocol: null,
    });
    expect(created.modelProtocol).toBeNull();
    await expect(
      updateVendorCredential(fixture.bindings, fixture.viewer, {
        id: created.id,
        projectId: fixture.ids.projectId,
        modelProtocol: "openai-chat-completions",
      }),
    ).rejects.toThrow("Preset provider credentials cannot declare a model protocol.");
    expect(
      (
        await updateVendorCredential(fixture.bindings, fixture.viewer, {
          id: created.id,
          projectId: fixture.ids.projectId,
          modelProtocol: null,
        })
      ).modelProtocol,
    ).toBeNull();
  });

  test.each(["unknown-protocol", "", "OPENAI_RESPONSES", 123])(
    "GraphQL rejects invalid protocol %s without storing credentials or secrets",
    async (modelProtocol) => {
      const fixture = await createApiTestFixture();
      const response = await graphql({
        schema: createGraphQLSchema(),
        source:
          "mutation Create($input: CreateVendorCredentialInput!) { createVendorCredential(input: $input) { id modelProtocol } }",
        variableValues: { input: { ...customInput(fixture.ids.projectId), modelProtocol } },
        contextValue: { bindings: fixture.bindings, viewer: fixture.viewer },
      });
      expect(response.errors?.length).toBe(1);
      expect(response.errors?.[0]?.message).toContain(
        typeof modelProtocol === "number"
          ? "String cannot represent"
          : "Unsupported model protocol.",
      );
      expect(
        await fixture.database
          .prepare("SELECT COUNT(*) AS count FROM vendor_credential")
          .first("count"),
      ).toBe(0);
      expect(
        await fixture.database.prepare("SELECT COUNT(*) AS count FROM vault_secret").first("count"),
      ).toBe(0);
    },
  );

  test("GraphQL returns the saved protocol on create and list", async () => {
    const fixture = await createApiTestFixture();
    const contextValue = { bindings: fixture.bindings, viewer: fixture.viewer };
    const schema = createGraphQLSchema();
    const created = await graphql({
      schema,
      contextValue,
      source:
        "mutation Create($input: CreateVendorCredentialInput!) { createVendorCredential(input: $input) { modelProtocol } }",
      variableValues: {
        input: { ...customInput(fixture.ids.projectId), modelProtocol: "google-gemini" },
      },
    });
    expect(created.errors).toBeUndefined();
    expect(created.data?.createVendorCredential).toEqual({ modelProtocol: "google-gemini" });
    const listed = await graphql({
      schema,
      contextValue,
      source:
        "query Credentials($projectId: ULID!) { vendorCredentialList(projectId: $projectId) { modelProtocol } }",
      variableValues: { projectId: fixture.ids.projectId },
    });
    expect(listed.errors).toBeUndefined();
    expect(listed.data?.vendorCredentialList).toEqual([{ modelProtocol: "google-gemini" }]);
  });
});
