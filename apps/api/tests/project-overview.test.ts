import { describe, expect, test } from "bun:test";

import { isObjectType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  getProjectOverview,
  getControlPlaneOverview,
} from "../src/modules/projects/application/project-overview.service";
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
        project_id,
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
      fixture.ids.projectId,
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
        project_id,
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
      fixture.ids.projectId,
      1,
      "openai-compatible",
    )
    .run();
}

describe("Project overview", () => {
  test("keeps the GraphQL overview surface Project-scoped and secret-free", () => {
    const schema = createGraphQLSchema();
    const query = schema.getQueryType();
    const projectOverview = schema.getType("ProjectOverview");
    const credential = schema.getType("ProjectOverviewProviderCredential");

    if (!query || !isObjectType(projectOverview) || !isObjectType(credential)) {
      throw new Error("Expected Project overview GraphQL types.");
    }

    const overview = query.getFields().projectOverview;
    const controlPlaneOverview = query.getFields().controlPlaneOverview;

    expect(overview).toBeDefined();
    expect(String(overview.args.find((arg) => arg.name === "projectId")?.type)).toBe("ULID!");
    expect(String(overview.args.find((arg) => arg.name === "agentLimit")?.type)).toBe("Int");
    expect(String(overview.args.find((arg) => arg.name === "credentialLimit")?.type)).toBe("Int");
    expect(Object.keys(projectOverview.getFields()).toSorted()).toEqual([
      "agents",
      "project",
      "providerCredentials",
    ]);
    expect(controlPlaneOverview).toBeDefined();
    expect(String(controlPlaneOverview.args.find((arg) => arg.name === "projectLimit")?.type)).toBe(
      "Int",
    );
    expect(credential.getFields().maskedApiKey).toBeUndefined();
    expect(credential.getFields().apiBase).toBeUndefined();
    expect(String(credential.getFields().status.type)).toBe(
      "ProjectOverviewProviderCredentialStatus!",
    );
  });

  test("returns limited control-plane summary without reading credential secrets", async () => {
    const fixture = await createApiTestFixture();
    await insertOverviewAgent(fixture, {
      id: "01J000000000000000000000F4",
      name: "Newest Agent",
      updatedAt: 2,
    });
    await insertOverviewCredentialMetadata(fixture);

    const overview = await getProjectOverview(fixture.bindings.DB, fixture.viewer, {
      agentLimit: 1,
      projectId: fixture.ids.projectId,
      credentialLimit: 10,
    });

    expect(overview.project).toMatchObject({
      id: fixture.ids.projectId,
      name: "Default Project",
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
        projectId: fixture.ids.projectId,
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
      projectLimit: 10,
      credentialLimit: 10,
    });

    expect(overview.activeOrganization).toMatchObject({
      id: fixture.ids.organizationId,
      name: "mosoo API Test",
    });
    expect(overview.projects).toMatchObject({
      hasMore: false,
      limit: 10,
    });
    expect(overview.projects.items).toHaveLength(1);
    expect(overview.projects.items[0]).toMatchObject({
      project: {
        id: fixture.ids.projectId,
        name: "Default Project",
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

  test("fails closed for viewers that do not own the Project", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      getProjectOverview(fixture.bindings.DB, makeForeignViewer(), {
        projectId: fixture.ids.projectId,
      }),
    ).rejects.toThrow("You do not have permission");
  });

  test("rejects invalid overview limits through the API error envelope", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      getProjectOverview(fixture.bindings.DB, fixture.viewer, {
        agentLimit: 0,
        projectId: fixture.ids.projectId,
      }),
    ).rejects.toThrow("agentLimit must be a positive integer.");
  });
});
