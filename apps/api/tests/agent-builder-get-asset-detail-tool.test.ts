import { describe, expect, test } from "bun:test";

import type { AgentBuilderToolPayload } from "@mosoo/contracts/agent-builder";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import type { AgentBuilderVisibleAssetSummaryCollections } from "../src/modules/agent-builder/application/agent-builder-visible-assets.types";
import { createGetAssetDetailTool } from "../src/modules/agent-builder/application/tools/get-asset-detail.tool";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const viewer: AuthenticatedViewer = {
  email: "xiaoke@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000051",
  imageUrl: null,
  name: "Xiaoke",
};

const DETAIL_IDS = {
  credential: "01J00000000000000000000401",
  environment: "01J00000000000000000000402",
  environmentRevision: "01J00000000000000000000403",
  fileOne: "01J00000000000000000000404",
  fileTwo: "01J00000000000000000000405",
  mcpGithub: "01J00000000000000000000406",
  skillHidden: "01J00000000000000000000407",
  skillSnapshot: "01J00000000000000000000408",
  skillSupport: "01J00000000000000000000409",
  spaceSupport: "01J00000000000000000000410",
} as const;

const draftYaml = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Support Agent",
  "runtime:",
  "  id: openai-runtime",
  "  provider: openai",
  "  model: gpt-5.4",
  "prompt: Help users.",
  "environment:",
  `  environmentId: ${DETAIL_IDS.environment}`,
  "assets:",
  "  agentsFileId: null",
  "  skills:",
  `    - ${DETAIL_IDS.skillSupport}`,
  "  mcpServers:",
  `    - ${DETAIL_IDS.mcpGithub}`,
  "  spaces:",
  `    - id: ${DETAIL_IDS.spaceSupport}`,
  "      name: Support KB",
].join("\n");

function createDetailFixture(): AgentBuilderVisibleAssetSummaryCollections {
  return {
    channels: [],
    environments: [
      {
        allowMcpServers: true,
        allowPackageManagers: true,
        bindingState: "bound",
        description: "Support runtime",
        envVarKeys: ["SUPPORT_TOKEN"],
        hash: "env-hash",
        id: DETAIL_IDS.environment,
        isBuiltIn: false,
        isDefault: false,
        name: "Support Environment",
        networkPolicy: "limited",
        packageManagers: ["npm"],
        setupScriptConfigured: true,
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    mcpServers: [
      {
        authType: "oauth",
        authorizationState: "active",
        bindingState: "bound",
        credentialScope: "user",
        credentialStatus: "active",
        description: "GitHub repository access",
        enabled: true,
        hash: "mcp-hash",
        id: DETAIL_IDS.mcpGithub,
        name: "GitHub MCP",
        source: "organization_shared",
        updatedAt: "2026-05-20T00:00:00.000Z",
        urlHost: "github.example.com",
      },
    ],
    selectedSpaceFiles: [
      {
        bindingState: "bound",
        directories: ["private/", "runbooks/"],
        directoryCount: 2,
        files: [
          {
            key: "private/token.txt",
            mimeType: "text/plain",
            size: 64,
          },
          {
            key: "runbooks/setup.md",
            mimeType: "text/markdown",
            size: 128,
          },
        ],
        fileCount: 2,
        hash: "space-files-hash",
        id: DETAIL_IDS.spaceSupport,
        listingState: "available",
        name: "Support KB",
        unavailableReason: null,
      },
    ],
    skills: [
      {
        bindingState: "bound",
        description: "Support macros",
        hash: "skill-support-hash",
        id: DETAIL_IDS.skillSupport,
        name: "Support Skill",
        ownerName: "Xiaoke",
        snapshotId: DETAIL_IDS.skillSnapshot,
        sourceKind: "user",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    spaces: [
      {
        bindingState: "bound",
        hash: "space-hash",
        id: DETAIL_IDS.spaceSupport,
        name: "Support KB",
        role: "admin",
        visibility: "private",
      },
    ],
  };
}

function createRuntime(fixture = createDetailFixture()) {
  return createAgentBuilderToolRuntime({
    tools: [
      createGetAssetDetailTool({
        bindings: {} as ApiBindings,
        collectSummaries: async () => fixture,
        draftYaml,
        organizationId: "01J00000000000000000000006",
        viewer,
      }),
    ],
  });
}

function detailFrom(output: AgentBuilderToolPayload | null): AgentBuilderToolPayload {
  const detail = output?.["detail"];

  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) {
    throw new Error("Expected get_asset_detail detail object.");
  }

  return detail as AgentBuilderToolPayload;
}

describe("get_asset_detail tool", () => {
  test("returns Skill detail from visible evidence without snapshot identifiers", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: DETAIL_IDS.skillSupport,
        assetType: "skill",
      },
      toolId: "get_asset_detail",
    });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      assetId: DETAIL_IDS.skillSupport,
      assetType: "skill",
      bindingState: "bound",
      name: "Support Skill",
      warnings: [],
    });
    expect(detailFrom(result.output)).toEqual({
      description: "Support macros",
      ownerName: "Xiaoke",
      sourceKind: "user",
      updatedAt: "2026-05-20T00:00:00.000Z",
    });
    expect(JSON.stringify(result.output)).not.toContain(DETAIL_IDS.skillSnapshot);
  });

  test("returns Environment detail without revision, env var previews, or setup script content", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: DETAIL_IDS.environment,
        assetType: "environment",
      },
      toolId: "get_asset_detail",
    });

    expect(result.output).toMatchObject({
      assetId: DETAIL_IDS.environment,
      assetType: "environment",
      bindingState: "bound",
      name: "Support Environment",
    });
    expect(detailFrom(result.output)).toEqual({
      allowMcpServers: true,
      allowPackageManagers: true,
      description: "Support runtime",
      envVarKeys: ["SUPPORT_TOKEN"],
      isBuiltIn: false,
      isDefault: false,
      networkPolicy: "limited",
      packageManagers: ["npm"],
      setupScriptConfigured: true,
      updatedAt: "2026-05-20T00:00:00.000Z",
    });
    expect(JSON.stringify(result.output)).not.toContain(DETAIL_IDS.environmentRevision);
    expect(JSON.stringify(result.output)).not.toContain("super-secret-preview");
    expect(JSON.stringify(result.output)).not.toContain("super-secret-token");
  });

  test("returns Space detail with visible selected file summaries only when requested", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: DETAIL_IDS.spaceSupport,
        assetType: "space",
        fileLimit: 1,
        includeFiles: true,
      },
      toolId: "get_asset_detail",
    });

    expect(result.output).toMatchObject({
      assetId: DETAIL_IDS.spaceSupport,
      assetType: "space",
      bindingState: "bound",
      name: "Support KB",
    });
    expect(detailFrom(result.output)).toEqual({
      files: {
        directories: [{ key: "private/" }],
        directoryCount: 2,
        fileCount: 2,
        files: [
          {
            key: "private/token.txt",
            mimeType: "text/plain",
            size: 64,
          },
        ],
        listingState: "available",
        unavailableReason: null,
      },
      role: "admin",
      visibility: "private",
    });
    expect(JSON.stringify(result.output)).not.toContain(DETAIL_IDS.fileOne);
    expect(JSON.stringify(result.output)).not.toContain(DETAIL_IDS.fileTwo);
    expect(JSON.stringify(result.output)).not.toContain("etag-secret");
  });

  test("returns MCP detail without credential identifiers or full URLs", async () => {
    const result = await createRuntime().execute({
      input: {
        assetId: DETAIL_IDS.mcpGithub,
        assetType: " mcp ",
      },
      toolId: "get_asset_detail",
    });

    expect(result.output).toMatchObject({
      assetId: DETAIL_IDS.mcpGithub,
      assetType: "mcp_server",
      bindingState: "bound",
      name: "GitHub MCP",
      warnings: [],
    });
    expect(detailFrom(result.output)).toEqual({
      authType: "oauth",
      authorizationState: "active",
      credentialScope: "user",
      credentialStatus: "active",
      description: "GitHub repository access",
      enabled: true,
      source: "organization_shared",
      updatedAt: "2026-05-20T00:00:00.000Z",
      urlHost: "github.example.com",
    });
    expect(JSON.stringify(result.output)).not.toContain(DETAIL_IDS.credential);
    expect(JSON.stringify(result.output)).not.toContain("super-secret-path");
  });

  test("rejects real but non-visible asset ids before loading detail", async () => {
    await expect(
      createRuntime().execute({
        input: {
          assetId: DETAIL_IDS.skillHidden,
          assetType: "skill",
        },
        toolId: "get_asset_detail",
      }),
    ).resolves.toMatchObject({
      errorMessage: expect.stringContaining(DETAIL_IDS.skillHidden),
      output: null,
      status: "failed",
      toolId: "get_asset_detail",
    });
  });

  test("fails unsupported asset types without throwing out of the runtime", async () => {
    await expect(
      createRuntime().execute({
        input: {
          assetId: "secret-1",
          assetType: "secret",
        },
        toolId: "get_asset_detail",
      }),
    ).resolves.toMatchObject({
      errorMessage: expect.stringContaining("secret"),
      output: null,
      status: "failed",
      toolId: "get_asset_detail",
    });
  });
});
