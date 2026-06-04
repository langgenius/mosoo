import { Permission } from "@mosoo/contracts/permission";
import { lazy } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { Navigate, useParams, useRoutes } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import {
  GuestRoute,
  OnboardingRoute,
  OrganizationPermissionRoute,
  ProtectedRoute,
} from "./route-guards";

type RouteModule<TName extends string> = Record<TName, ComponentType>;

function lazyNamed<TName extends string>(
  load: () => Promise<RouteModule<TName>>,
  exportName: TName,
) {
  return lazy(async () => {
    const routeModule = await load();
    return { default: routeModule[exportName] };
  });
}

function protectedRoute(element: ReactElement): ReactElement {
  return <ProtectedRoute>{element}</ProtectedRoute>;
}

function NavigateToEnvironmentAlias(): ReactElement {
  const { environmentId } = useParams();

  return (
    <Navigate
      replace
      to={environmentId === undefined ? "/environment" : `/environment/${environmentId}`}
    />
  );
}

const Login = lazyNamed(async () => import("../routes/login/login.route"), "LoginPage");
const Onboarding = lazyNamed(
  async () => import("../routes/onboarding/onboarding.route"),
  "Onboarding",
);
const JoinOrganization = lazyNamed(
  async () => import("../routes/organization-join/organization-join.route"),
  "OrganizationJoinPage",
);
const Space = lazyNamed(async () => import("../routes/spaces/spaces.route"), "SpacePage");
const Environments = lazyNamed(
  async () => import("../routes/environments/environments.route"),
  "EnvironmentsPage",
);
const SkillsTabRoute = lazyNamed(
  async () => import("../routes/integrations/skills/skills-tab"),
  "SkillsTab",
);
const McpTabRoute = lazyNamed(async () => import("../routes/integrations/mcp/mcp-tab"), "McpTab");
const McpOAuthComplete = lazyNamed(
  async () => import("../routes/integrations/mcp/oauth-complete.route"),
  "McpOAuthCompletePage",
);
const Providers = lazyNamed(
  async () => import("../routes/providers/providers.route"),
  "ProvidersPage",
);
const CredentialPolicy = lazyNamed(
  async () => import("../routes/credential-policy/credential-policy.route"),
  "CredentialPolicyPage",
);
const Members = lazyNamed(async () => import("../routes/members/members.route"), "MembersPage");
const Cost = lazyNamed(async () => import("../routes/cost/cost.route"), "CostPage");
const SettingsLayout = lazyNamed(
  async () => import("../routes/settings/settings.route"),
  "SettingsLayout",
);
const SettingsProfile = lazyNamed(
  async () => import("../routes/settings/profile-tab"),
  "ProfileTab",
);
const SettingsAccessTokens = lazyNamed(
  async () => import("../routes/settings/access-tokens-tab"),
  "AccessTokensTab",
);
const SettingsSystemAgent = lazyNamed(
  async () => import("../routes/settings/system-agent-tab"),
  "SystemAgentTab",
);
const SettingsUsage = lazyNamed(async () => import("../routes/settings/usage-tab"), "UsageTab");
const SettingsOrganizationGeneral = lazyNamed(
  async () => import("../routes/settings/organization-general-tab"),
  "OrganizationGeneralTab",
);
const SettingsOrganizationEnvironments = lazyNamed(
  async () => import("../routes/settings/organization-environments-tab"),
  "OrganizationEnvironmentsTab",
);
const AgentList = lazyNamed(
  async () => import("../routes/agent/agent-list.route"),
  "AgentListPage",
);
const AgentDetail = lazyNamed(
  async () => import("../routes/agent/agent-detail.route"),
  "AgentDetailPage",
);
const AgentSlackChannelSetup = lazyNamed(
  async () => import("../routes/agent/slack-channel-setup.route"),
  "AgentSlackChannelSetupPage",
);
const Threads = lazyNamed(async () => import("../routes/threads/route"), "ThreadsPage");
const ProviderDemo = lazyNamed(
  async () => import("../routes/demo/provider-demo.route"),
  "ProviderDemoPage",
);

const appRoutes = [
  {
    element: (
      <GuestRoute>
        <Login />
      </GuestRoute>
    ),
    path: "/login",
  },
  {
    element: (
      <OnboardingRoute>
        <Onboarding />
      </OnboardingRoute>
    ),
    path: "/onboarding",
  },
  { element: <JoinOrganization />, path: "/join/:organizationId" },
  { element: <McpOAuthComplete />, path: "/integrations/mcp/oauth-complete" },
  { element: protectedRoute(<Navigate to="/agent" replace />), path: "/" },
  { element: protectedRoute(<Space />), path: "/space" },
  { element: protectedRoute(<Navigate to="/space" replace />), path: "/spaces" },
  { element: protectedRoute(<Environments />), path: "/environment" },
  { element: protectedRoute(<Environments />), path: "/environment/:environmentId" },
  { element: protectedRoute(<Navigate to="/environment" replace />), path: "/environments" },
  {
    element: protectedRoute(<NavigateToEnvironmentAlias />),
    path: "/environments/:environmentId",
  },
  {
    element: protectedRoute(<Navigate to="/integrations/skills" replace />),
    path: "/integrations",
  },
  { element: protectedRoute(<Navigate to="/integrations/skills" replace />), path: "/skill" },
  { element: protectedRoute(<Navigate to="/integrations/skills" replace />), path: "/skills" },
  { element: protectedRoute(<Navigate to="/integrations/mcp" replace />), path: "/mcp" },
  { element: protectedRoute(<SkillsTabRoute />), path: "/integrations/skills" },
  { element: protectedRoute(<McpTabRoute />), path: "/integrations/mcp" },
  { element: protectedRoute(<AgentList />), path: "/agent" },
  { element: protectedRoute(<AgentSlackChannelSetup />), path: "/agent/:agentId/channels/new" },
  { element: protectedRoute(<AgentDetail />), path: "/agent/:agentId" },
  { element: protectedRoute(<Threads />), path: "/threads" },
  { element: protectedRoute(<Threads />), path: "/threads/:threadId" },
  {
    children: [
      { element: <Navigate to="/settings/profile" replace />, index: true },
      { element: <SettingsProfile />, path: "profile" },
      { element: <SettingsAccessTokens />, path: "access-tokens" },
      { element: <SettingsSystemAgent />, path: "system-agent" },
      { element: <SettingsUsage />, path: "usage" },
      { element: <SettingsOrganizationGeneral />, path: "general" },
      { element: <Members />, path: "members" },
      { element: <SettingsOrganizationEnvironments />, path: "environments" },
      { element: <CredentialPolicy />, path: "credential-policy" },
    ],
    element: protectedRoute(<SettingsLayout />),
    path: "/settings",
  },
  { element: protectedRoute(<Navigate to="/settings/profile" replace />), path: "/profile" },
  { element: protectedRoute(<Navigate to="/settings/usage" replace />), path: "/usage" },
  { element: protectedRoute(<Navigate to="/settings/members" replace />), path: "/members" },
  { element: protectedRoute(<Providers />), path: "/providers" },
  {
    element: protectedRoute(
      <OrganizationPermissionRoute
        description="Workspace Cost is available to organization admins. You can still review your own usage in Settings."
        permission={Permission.CostOrganizationRead}
      >
        <Cost />
      </OrganizationPermissionRoute>,
    ),
    path: "/cost",
  },
  {
    element: protectedRoute(<Navigate to="/settings/credential-policy" replace />),
    path: "/credential-policy",
  },
  { element: protectedRoute(<ProviderDemo />), path: "/demo/provider" },
] satisfies RouteObject[];

export function AppRoutes(): ReactNode {
  const routes = useRoutes(appRoutes);
  return routes;
}
