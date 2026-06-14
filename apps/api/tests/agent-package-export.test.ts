import { describe, expect, test } from "bun:test";

import type { AgentManifest } from "@mosoo/contracts/agent-manifest";
import { AGENT_MANIFEST_VERSION } from "@mosoo/contracts/agent-manifest";
import { serializeAgentManifestToYaml } from "@mosoo/contracts/agent-manifest-serializer";

import { createPortableAgentPackageManifest } from "../src/modules/agents/application/agent-package-export.service";

const SOURCE_IDS = {
  environment: "01J00000000000000000000002",
  mcpServer: "01J00000000000000000000003",
  skill: "01J00000000000000000000004",
  space: "01J00000000000000000000005",
} as const;

function createSourceManifest(): AgentManifest {
  return {
    advanced: null,
    environment: {
      environmentId: SOURCE_IDS.environment,
      envVars: {
        API_TOKEN: "source-secret",
      },
      expectedName: "Production tools",
      setupScript: "bun install",
    },
    kind: "pet",
    manifestVersion: AGENT_MANIFEST_VERSION,
    mcpServers: [
      {
        authType: "oauth",
        credentialMode: "runtime_resolved",
        credentialScope: "app",
        enabled: true,
        iconUrl: null,
        name: "Linear",
        serverId: SOURCE_IDS.mcpServer,
        source: "app",
        url: "https://linear.example/mcp",
      },
    ],
    metadata: {
      description: "Imported safely",
      name: "Portable Agent",
    },
    prompts: {
      system: "Help",
    },
    runtime: {
      id: "openai-runtime",
      model: "gpt-5.4",
      provider: "openai",
      providerOptions: {},
    },
    skills: [
      {
        ownerName: "Source Owner",
        skillId: SOURCE_IDS.skill,
        skillName: "Billing Helper",
        state: "active",
      },
    ],
    spaces: [
      {
        alias: "docs",
        expectedName: "Product Docs",
        mode: "read",
        required: true,
        spaceId: SOURCE_IDS.space,
      },
    ],
  };
}

describe("agent package export", () => {
  test("creates a portable manifest without source resource ids", () => {
    const manifest = createPortableAgentPackageManifest(createSourceManifest());

    expect(manifest.environment).toMatchObject({
      environmentId: null,
      envVars: { API_TOKEN: "" },
      expectedName: "Production tools",
    });
    expect(manifest.mcpServers[0]?.serverId).toBeNull();
    expect(manifest.skills[0]?.skillId).toBe("skills/billing-helper/");
    expect(manifest.spaces[0]?.spaceId).toBeNull();

    const manifestYaml = serializeAgentManifestToYaml(manifest);

    for (const sourceId of Object.values(SOURCE_IDS)) {
      expect(manifestYaml).not.toContain(sourceId);
    }
  });
});
