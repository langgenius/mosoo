import type { AgentBuilderVisibleAssetSummaryCollections } from "../src/modules/agent-builder/application/agent-builder-visible-assets.types";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";

export const viewer: AuthenticatedViewer = {
  email: "xiaoke@mosoo.ai",
  emailVerified: true,
  id: "01J00000000000000000000051",
  imageUrl: null,
  name: "Xiaoke",
};

function emptySummaries(): AgentBuilderVisibleAssetSummaryCollections {
  return {
    channels: [],
    environments: [],
    mcpServers: [],
    selectedSpaceFiles: [],
    skills: [],
    spaces: [],
  };
}

export function createResolveFixture(): AgentBuilderVisibleAssetSummaryCollections {
  return {
    ...emptySummaries(),
    environments: [
      {
        allowMcpServers: true,
        allowPackageManagers: true,
        bindingState: "bound",
        description: "Node runtime for support workflows",
        envVarKeys: ["SUPPORT_TOKEN"],
        hash: "env-hash",
        id: "env_support",
        isBuiltIn: false,
        isDefault: false,
        name: "Support Environment",
        networkPolicy: "limited",
        packageManagers: ["npm"],
        setupScriptConfigured: true,
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        allowMcpServers: true,
        allowPackageManagers: true,
        bindingState: "not_bound",
        description: "Limited Linear API runtime",
        envVarKeys: ["LINEAR_API_KEY"],
        hash: "env-linear-hash",
        id: "env_linear",
        isBuiltIn: false,
        isDefault: false,
        name: "Linear limited environment",
        networkPolicy: "limited",
        packageManagers: ["pip"],
        setupScriptConfigured: false,
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        allowMcpServers: true,
        allowPackageManagers: true,
        bindingState: "not_bound",
        description: "Python analysis runtime",
        envVarKeys: [],
        hash: "env-python-hash",
        id: "env_python",
        isBuiltIn: false,
        isDefault: false,
        name: "Python data environment",
        networkPolicy: "full",
        packageManagers: ["pip"],
        setupScriptConfigured: false,
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    mcpServers: [
      {
        authType: "bearer",
        authorizationState: "authorized",
        bindingState: "bound",
        credentialScope: "user",
        credentialStatus: "configured",
        description: "Linear issue access",
        enabled: true,
        hash: "mcp-linear-hash",
        id: "mcp_linear",
        name: "Linear MCP",
        source: "personal",
        updatedAt: "2026-05-20T00:00:00.000Z",
        urlHost: "mcp.linear.example.com",
      },
      {
        authType: "oauth",
        authorizationState: "authorized",
        bindingState: "not_bound",
        credentialScope: "user",
        credentialStatus: "configured",
        description: "GitHub repository access",
        enabled: true,
        hash: "mcp-hash",
        id: "mcp_github",
        name: "GitHub MCP",
        source: "organization_shared",
        updatedAt: "2026-05-20T00:00:00.000Z",
        urlHost: "github.example.com",
      },
      {
        authType: "bearer",
        authorizationState: "authorized",
        bindingState: "not_bound",
        credentialScope: "user",
        credentialStatus: "configured",
        description: "Planner fixture Linear MCP",
        enabled: true,
        hash: "mcp-ab-planner-linear-hash",
        id: "mcp_ab_planner_linear",
        name: "ab-planner-linear-mcp",
        source: "organization_shared",
        updatedAt: "2026-05-20T00:00:00.000Z",
        urlHost: "linear.example.com",
      },
    ],
    skills: [
      {
        bindingState: "bound",
        description: "Already mounted Skill",
        hash: "skill-existing-hash",
        id: "skill_existing",
        name: "Existing Skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-existing",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        bindingState: "not_bound",
        description: "Reusable support response macros",
        hash: "skill-support-hash",
        id: "skill_support",
        name: "Support Skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-support",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        bindingState: "not_bound",
        description: "Reusable support response macros for finance",
        hash: "skill-support-finance-hash",
        id: "skill_support_finance",
        name: "Support Skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-support-finance",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        bindingState: "not_bound",
        description: "Routes billing tickets",
        hash: "skill-billing-hash",
        id: "skill_billing",
        name: "Billing Skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-billing",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
      {
        bindingState: "not_bound",
        description: "Planner fixture sales follow-up workflow helper",
        hash: "skill-ab-planner-sales-hash",
        id: "skill_ab_planner_sales_followup",
        name: "ab-planner-sales-followup-skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-ab-planner-sales",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    spaces: [
      {
        bindingState: "bound",
        hash: "space-hash",
        id: "space_support",
        name: "support-kb",
        role: "admin",
        visibility: "private",
      },
      {
        bindingState: "not_bound",
        hash: "space-hash-2",
        id: "space_support_2",
        name: "support-kb-2",
        role: "read",
        visibility: "shared",
      },
      {
        bindingState: "not_bound",
        hash: "space-ab-planner-sales-hash",
        id: "space_ab_planner_sales_playbook",
        name: "ab-planner-sales-playbook",
        role: "read",
        visibility: "shared",
      },
    ],
  };
}

export function createResolveFixtureWithBoundLinearEnvironment(): AgentBuilderVisibleAssetSummaryCollections {
  const fixture = createResolveFixture();
  const environments = fixture.environments.map((environment) => {
    if (environment.id !== "env_linear") {
      return environment;
    }

    const nextEnvironment = { ...environment };
    nextEnvironment.bindingState = "bound";
    return nextEnvironment;
  });

  return {
    ...fixture,
    environments,
  };
}

export function createResolveFixtureWithPlannerEnvironment(): AgentBuilderVisibleAssetSummaryCollections {
  const fixture = createResolveFixture();

  return {
    ...fixture,
    environments: [
      ...fixture.environments,
      {
        allowMcpServers: true,
        allowPackageManagers: true,
        bindingState: "not_bound",
        description: "Planner fixture default runtime",
        envVarKeys: [],
        hash: "env-ab-planner-system-default-hash",
        id: "env_ab_planner_system_default",
        isBuiltIn: false,
        isDefault: false,
        name: "ab-planner-system-default",
        networkPolicy: "full",
        packageManagers: ["npm"],
        setupScriptConfigured: false,
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
  };
}

export function createResolveFixtureWithAmbiguousPlannerAssets(): AgentBuilderVisibleAssetSummaryCollections {
  const fixture = createResolveFixtureWithPlannerEnvironment();

  return {
    ...fixture,
    environments: [
      ...fixture.environments,
      {
        allowMcpServers: true,
        allowPackageManagers: true,
        bindingState: "not_bound",
        description: "Planner fixture limited Linear runtime",
        envVarKeys: ["LINEAR_API_KEY"],
        hash: "env-ab-planner-linear-limited-hash",
        id: "env_ab_planner_linear_limited",
        isBuiltIn: false,
        isDefault: false,
        name: "ab-planner-linear-limited-env",
        networkPolicy: "limited",
        packageManagers: ["npm"],
        setupScriptConfigured: false,
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    mcpServers: [
      ...fixture.mcpServers,
      {
        authType: "oauth",
        authorizationState: "authorized",
        bindingState: "not_bound",
        credentialScope: "user",
        credentialStatus: "configured",
        description: "Planner fixture GitHub MCP",
        enabled: true,
        hash: "mcp-ab-planner-github-hash",
        id: "mcp_ab_planner_github",
        name: "ab-planner-github-mcp",
        source: "organization_shared",
        updatedAt: "2026-05-20T00:00:00.000Z",
        urlHost: "github.example.com",
      },
    ],
    skills: [
      ...fixture.skills,
      {
        bindingState: "not_bound",
        description: "Planner fixture support workflow helper",
        hash: "skill-ab-planner-support-hash",
        id: "skill_ab_planner_support",
        name: "ab-planner-support-skill",
        ownerName: "Xiaoke",
        snapshotId: "snapshot-ab-planner-support",
        sourceKind: "manual",
        updatedAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    spaces: [
      ...fixture.spaces,
      {
        bindingState: "not_bound",
        hash: "space-ab-planner-support-hash",
        id: "space_ab_planner_support",
        name: "ab-planner-support-space",
        role: "read",
        visibility: "shared",
      },
    ],
  };
}
