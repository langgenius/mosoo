import { describe, expect, test } from "bun:test";

import { isObjectType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import {
  getAppOverview,
  getControlPlaneOverview,
} from "../src/modules/apps/application/app-overview.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createApiTestFixture } from "./helpers/api-test-fixture";

function makeForeignViewer(): AuthenticatedViewer {
  return {
    email: "foreign@example.com",
    emailVerified: true,
    id: "01J000000000000000000000F1",
    imageUrl: null,
    name: "Foreign Viewer",
  };
}

async function insertOverviewAgent(
  fixture: Awaited<ReturnType<typeof createApiTestFixture>>,
  input: {
    id: string;
    name: string;
    updatedAt: number;
  },
): Promise<void> {
  await fixture.database
    .prepare(
      `INSERT INTO agent (
        config_json,
        created_at,
        description,
        id,
        kind,
        model,
        name,
        owner_account_id,
        app_id,
        prompt,
        provider,
        runtime_id,
        status,
        updated_at,
        visibility
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      JSON.stringify({
        packageMcpServers: [],
        packageResolution: null,
        packageSkills: [],
        providerOptions: {},
      }),
      1,
      "Extra overview fixture.",
      input.id,
      "cattle",
      "gpt-5.4",
      input.name,
      fixture.viewer.id,
      fixture.ids.appId,
      "Help with overview tests.",
      "openai",
      "openai-runtime",
      "published",
      input.updatedAt,
      "private",
    )
    .run();
}

async function insertOverviewCredentialMetadata(
  fixture: Awaited<ReturnType<typeof createApiTestFixture>>,
): Promise<void> {
  await fixture.database
    .prepare(
      `INSERT INTO vendor_credential (
        api_base,
        api_key_secret_id,
        created_at,
        id,
        is_default,
        models,
        name,
        app_id,
        updated_at,
        vendor_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "https://api.example.com/v1",
      "01J000000000000000000000F2",
      1,
      "01J000000000000000000000F3",
      1,
      JSON.stringify(["custom-a", "custom-b"]),
      "Custom Provider",
      fixture.ids.appId,
      1,
      "openai-compatible",
    )
    .run();
}

describe("App overview", () => {
  test("keeps the GraphQL overview surface App-scoped and secret-free", () => {
    const schema = createGraphQLSchema();
    const query = schema.getQueryType();
    const appOverview = schema.getType("AppOverview");
    const credential = schema.getType("AppOverviewProviderCredential");

    if (!query || !isObjectType(appOverview) || !isObjectType(credential)) {
      throw new Error("Expected App overview GraphQL types.");
    }

    const overview = query.getFields().appOverview;
    const controlPlaneOverview = query.getFields().controlPlaneOverview;

    expect(overview).toBeDefined();
    expect(String(overview.args.find((arg) => arg.name === "appId")?.type)).toBe("ULID!");
    expect(String(overview.args.find((arg) => arg.name === "agentLimit")?.type)).toBe("Int");
    expect(String(overview.args.find((arg) => arg.name === "credentialLimit")?.type)).toBe("Int");
    expect(controlPlaneOverview).toBeDefined();
    expect(String(controlPlaneOverview.args.find((arg) => arg.name === "appLimit")?.type)).toBe(
      "Int",
    );
    expect(credential.getFields().maskedApiKey).toBeUndefined();
    expect(credential.getFields().apiBase).toBeUndefined();
    expect(String(credential.getFields().status.type)).toBe("AppOverviewProviderCredentialStatus!");
  });

  test("returns limited control-plane summary without reading credential secrets", async () => {
    const fixture = await createApiTestFixture();
    await insertOverviewAgent(fixture, {
      id: "01J000000000000000000000F4",
      name: "Newest Agent",
      updatedAt: 2,
    });
    await insertOverviewCredentialMetadata(fixture);

    const overview = await getAppOverview(fixture.bindings.DB, fixture.viewer, {
      agentLimit: 1,
      appId: fixture.ids.appId,
      credentialLimit: 10,
    });

    expect(overview.app).toMatchObject({
      id: fixture.ids.appId,
      name: "Default App",
    });
    expect(overview.agents).toMatchObject({
      hasMore: true,
      limit: 1,
    });
    expect(overview.agents.items).toEqual([
      expect.objectContaining({
        id: "01J000000000000000000000F4",
        model: "gpt-5.4",
        name: "Newest Agent",
        provider: "openai",
        runtimeId: "openai-runtime",
        status: "published",
      }),
    ]);
    expect(overview.providerCredentials).toMatchObject({
      configuredCount: 1,
      hasMore: false,
      limit: 10,
    });
    expect(overview.providerCredentials.items).toEqual([
      {
        appId: fixture.ids.appId,
        hasCustomApiBase: true,
        id: "01J000000000000000000000F3",
        isDefault: true,
        modelCount: 2,
        name: "Custom Provider",
        status: "configured",
        vendorId: "openai-compatible",
      },
    ]);
    expect(overview.providerCredentials.byVendor).toEqual([
      {
        count: 1,
        defaultCredentialId: "01J000000000000000000000F3",
        vendorId: "openai-compatible",
      },
    ]);
  });

  test("returns current-user control-plane overview for generated CLI list flows", async () => {
    const fixture = await createApiTestFixture();
    await insertOverviewCredentialMetadata(fixture);

    const overview = await getControlPlaneOverview(fixture.bindings.DB, fixture.viewer, {
      agentLimit: 10,
      appLimit: 10,
      credentialLimit: 10,
    });

    expect(overview.activeOrganization).toMatchObject({
      id: fixture.ids.organizationId,
      name: "Mosoo API Test",
    });
    expect(overview.apps).toMatchObject({
      hasMore: false,
      limit: 10,
    });
    expect(overview.apps.items).toHaveLength(1);
    expect(overview.apps.items[0]).toMatchObject({
      app: {
        id: fixture.ids.appId,
        name: "Default App",
      },
      agents: {
        hasMore: false,
        limit: 10,
      },
      providerCredentials: {
        configuredCount: 1,
        hasMore: false,
        limit: 10,
      },
    });
  });

  test("fails closed for viewers that do not own the App", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      getAppOverview(fixture.bindings.DB, makeForeignViewer(), {
        appId: fixture.ids.appId,
      }),
    ).rejects.toThrow("You do not have permission");
  });

  test("rejects invalid overview limits through the API error envelope", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      getAppOverview(fixture.bindings.DB, fixture.viewer, {
        agentLimit: 0,
        appId: fixture.ids.appId,
      }),
    ).rejects.toThrow("agentLimit must be a positive integer.");
  });
});
