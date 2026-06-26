import { describe, expect, test } from "bun:test";

import { isInputObjectType, isObjectType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import {
  getAppOverview,
  getControlPlaneOverview,
} from "../src/modules/apps/application/app-overview.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createApiTestFixture } from "./helpers/api-test-fixture";

const OVERVIEW_DEPLOYMENT_ID = "01J000000000000000000000D1";
const OVERVIEW_DEPLOYMENT_RUN_ID = "01J000000000000000000000D2";

function createOverviewDeploymentUrl(appId: string, domain: string): string {
  return `https://app-${appId.toLowerCase()}.${domain}`;
}

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

async function insertOverviewDeploymentMetadata(
  fixture: Awaited<ReturnType<typeof createApiTestFixture>>,
): Promise<{ liveUrl: string }> {
  const liveUrl = createOverviewDeploymentUrl(
    fixture.ids.appId,
    fixture.bindings.MOSOO_APP_DEPLOYMENT_DOMAIN,
  );

  await fixture.database
    .prepare(
      `INSERT INTO app_deployment (
        app_id,
        created_at,
        default_branch,
        deleted_at,
        id,
        last_successful_url,
        mosoo_subdomain,
        owner_account_id,
        repo_name,
        repo_owner,
        repo_url,
        source_kind,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      fixture.ids.appId,
      1,
      "main",
      null,
      OVERVIEW_DEPLOYMENT_ID,
      liveUrl,
      `app-${fixture.ids.appId.toLowerCase()}`,
      fixture.viewer.id,
      "awire",
      "samzong",
      "https://github.com/samzong/awire.git",
      "github_public",
      2,
    )
    .run();

  await fixture.database
    .prepare(
      `INSERT INTO app_deployment_run (
        app_id,
        created_at,
        deployment_id,
        error_code,
        error_message,
        id,
        source_branch,
        source_commit_sha,
        status,
        target_kind,
        updated_at,
        url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      fixture.ids.appId,
      1,
      OVERVIEW_DEPLOYMENT_ID,
      null,
      null,
      OVERVIEW_DEPLOYMENT_RUN_ID,
      "main",
      "abc123",
      "success",
      "cloudflare_pages",
      2,
      liveUrl,
    )
    .run();

  return { liveUrl };
}

describe("App overview", () => {
  test("keeps the GraphQL overview surface App-scoped and secret-free", () => {
    const schema = createGraphQLSchema();
    const query = schema.getQueryType();
    const mutation = schema.getMutationType();
    const appOverview = schema.getType("AppOverview");
    const credential = schema.getType("AppOverviewProviderCredential");
    const deployment = schema.getType("AppDeployment");
    const deploymentRun = schema.getType("AppDeploymentRun");
    const deployInput = schema.getType("DeployAppInput");

    if (
      !query ||
      !mutation ||
      !isObjectType(appOverview) ||
      !isObjectType(credential) ||
      !isObjectType(deployment) ||
      !isObjectType(deploymentRun) ||
      !isInputObjectType(deployInput)
    ) {
      throw new Error("Expected App overview GraphQL types.");
    }

    const overview = query.getFields().appOverview;
    const deploymentStatus = query.getFields().appDeploymentStatus;
    const controlPlaneOverview = query.getFields().controlPlaneOverview;
    const deploy = mutation.getFields().deployApp;
    const deleteDeployment = mutation.getFields().deleteAppDeployment;

    expect(overview).toBeDefined();
    expect(String(overview.args.find((arg) => arg.name === "appId")?.type)).toBe("ULID!");
    expect(String(overview.args.find((arg) => arg.name === "agentLimit")?.type)).toBe("Int");
    expect(String(overview.args.find((arg) => arg.name === "credentialLimit")?.type)).toBe("Int");
    expect(String(appOverview.getFields().deployment.type)).toBe("AppDeployment");
    expect(String(deployment.getFields().latestRun.type)).toBe("AppDeploymentRun");
    expect(String(deploymentRun.getFields().status.type)).toBe("AppDeploymentRunStatus!");
    expect(String(deploymentStatus.type)).toBe("AppDeploymentRun");
    expect(String(deploy.type)).toBe("AppDeploymentRun!");
    expect(String(deleteDeployment.type)).toBe("OperationResult!");
    expect(String(deployInput.getFields().repoUrl.type)).toBe("String!");
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
    const deploymentFixture = await insertOverviewDeploymentMetadata(fixture);

    const overview = await getAppOverview(fixture.bindings, fixture.viewer, {
      agentLimit: 1,
      appId: fixture.ids.appId,
      credentialLimit: 10,
    });

    expect(overview.app).toMatchObject({
      id: fixture.ids.appId,
      name: "Default App",
    });
    expect(overview.deployment).toMatchObject({
      latestRun: {
        liveUrl: deploymentFixture.liveUrl,
        status: "success",
        targetKind: "cloudflare_pages",
      },
      liveUrl: deploymentFixture.liveUrl,
      plannedUrl: deploymentFixture.liveUrl,
      repoName: "awire",
      repoOwner: "samzong",
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

    const overview = await getControlPlaneOverview(fixture.bindings, fixture.viewer, {
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
      deployment: null,
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
      getAppOverview(fixture.bindings, makeForeignViewer(), {
        appId: fixture.ids.appId,
      }),
    ).rejects.toThrow("You do not have permission");
  });

  test("rejects invalid overview limits through the API error envelope", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      getAppOverview(fixture.bindings, fixture.viewer, {
        agentLimit: 0,
        appId: fixture.ids.appId,
      }),
    ).rejects.toThrow("agentLimit must be a positive integer.");
  });
});
