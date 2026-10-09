import { lazy } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { Link, Navigate, useRoutes } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { FileQuestion } from "@/shared/ui/icons";

import { GuestRoute, OnboardingRoute, ProtectedRoute } from "./route-guards";
import { useAppSession } from "./session/session-context";

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

// A multi-Project owner without a selected Project picks one on the Projects list.
function ActiveProjectGate({ children }: { children: ReactElement }): ReactElement {
  const { activeProject, projectsLoading } = useAppSession();
  const { t } = useTranslation();

  if (projectsLoading) {
    return (
      <div className="text-fg-3 flex h-full items-center justify-center text-[13px]">
        {t("common.loadingProject")}
      </div>
    );
  }

  return activeProject === null ? <Navigate to="/projects" replace /> : children;
}

function protectedRoute(element: ReactElement): ReactElement {
  return (
    <ProtectedRoute>
      <ActiveProjectGate>{element}</ActiveProjectGate>
    </ProtectedRoute>
  );
}

// CLI sign-in, account settings and the not-found page need a signed-in user
// but no active Project.
function accountRoute(element: ReactElement): ReactElement {
  return <ProtectedRoute>{element}</ProtectedRoute>;
}

function orgProtectedRoute(element: ReactElement): ReactElement {
  return <ProtectedRoute shell="org">{element}</ProtectedRoute>;
}

function NotFoundPage(): ReactElement {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={FileQuestion}
      title={t("notFound.title")}
      description={t("notFound.description")}
    >
      <Button asChild size="sm">
        <Link to="/">{t("notFound.backToOverview")}</Link>
      </Button>
    </EmptyState>
  );
}

const Login = lazyNamed(async () => import("../routes/login/login.route"), "LoginPage");
const Onboarding = lazyNamed(
  async () => import("../routes/onboarding/onboarding.route"),
  "Onboarding",
);
const Environments = lazyNamed(
  async () => import("../routes/environments/environments.route"),
  "EnvironmentsPage",
);
const Files = lazyNamed(async () => import("../routes/files/files.route"), "FilesPage");
const SkillsTabRoute = lazyNamed(
  async () => import("../routes/integrations/skills/skills-tab"),
  "SkillsTab",
);
const McpTabRoute = lazyNamed(async () => import("../routes/integrations/mcp/mcp-tab"), "McpTab");
const McpOAuthComplete = lazyNamed(
  async () => import("../routes/integrations/mcp/oauth-complete.route"),
  "McpOAuthCompletePage",
);
const CliAuth = lazyNamed(async () => import("../routes/cli-auth/cli-auth.route"), "CliAuthPage");
const Providers = lazyNamed(
  async () => import("../routes/providers/providers.route"),
  "ProvidersPage",
);
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
const ProjectSettingsLayout = lazyNamed(
  async () => import("../routes/project-settings/project-settings.route"),
  "ProjectSettingsLayout",
);
const ProjectSettingsGeneral = lazyNamed(
  async () => import("../routes/project-settings/general-tab"),
  "GeneralTab",
);
const ProjectUsage = lazyNamed(async () => import("../routes/cost/cost.route"), "CostPage");
const AgentList = lazyNamed(
  async () => import("../routes/agent/agent-list.route"),
  "AgentListPage",
);
const AgentDetail = lazyNamed(
  async () => import("../routes/agent/agent-detail.route"),
  "AgentDetailPage",
);
const Threads = lazyNamed(async () => import("../routes/threads/controller"), "ThreadsController");
const ProjectOverview = lazyNamed(
  async () => import("../routes/project-overview/project-overview.route"),
  "ProjectOverviewPage",
);
const ProjectsList = lazyNamed(
  async () => import("../routes/projects/projects-list.route"),
  "ProjectsListPage",
);
const OrgSettings = lazyNamed(
  async () => import("../routes/org/org-settings.route"),
  "OrgSettingsPage",
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
  { element: <McpOAuthComplete />, path: "/integrations/mcp/oauth-complete" },
  { element: accountRoute(<CliAuth />), path: "/cli-auth" },
  { element: protectedRoute(<ProjectOverview />), path: "/" },
  { element: orgProtectedRoute(<ProjectsList />), path: "/projects" },
  // Read-only redirects preserve bookmarks written before the Project rename.
  { element: orgProtectedRoute(<Navigate to="/projects" replace />), path: "/apps" },
  { element: orgProtectedRoute(<OrgSettings />), path: "/org/settings" },
  { element: protectedRoute(<Files />), path: "/files" },
  { element: protectedRoute(<Environments />), path: "/environment" },
  { element: protectedRoute(<Environments />), path: "/environment/:environmentId" },
  { element: protectedRoute(<SkillsTabRoute />), path: "/integrations/skills" },
  { element: protectedRoute(<McpTabRoute />), path: "/integrations/mcp" },
  { element: protectedRoute(<AgentList />), path: "/agent" },
  { element: protectedRoute(<AgentDetail />), path: "/agent/:agentId" },
  { element: protectedRoute(<Threads />), path: "/threads" },
  { element: protectedRoute(<Threads />), path: "/threads/:threadId" },
  {
    children: [
      { element: <Navigate to="/project-settings/general" replace />, index: true },
      { element: <ProjectSettingsGeneral />, path: "general" },
      { element: <SettingsAccessTokens />, path: "api-keys" },
      { element: <ProjectUsage />, path: "usage" },
    ],
    element: protectedRoute(<ProjectSettingsLayout />),
    path: "/project-settings",
  },
  {
    element: protectedRoute(<Navigate to="/project-settings/general" replace />),
    path: "/app-settings",
  },
  {
    element: protectedRoute(<Navigate to="/project-settings/general" replace />),
    path: "/app-settings/general",
  },
  {
    element: protectedRoute(<Navigate to="/project-settings/usage" replace />),
    path: "/app-settings/usage",
  },
  {
    children: [
      { element: <Navigate to="/settings/profile" replace />, index: true },
      { element: <SettingsProfile />, path: "profile" },
      { element: <Navigate to="/project-settings/api-keys" replace />, path: "access-tokens" },
    ],
    element: accountRoute(<SettingsLayout />),
    path: "/settings",
  },
  { element: protectedRoute(<Providers />), path: "/providers" },
  { element: accountRoute(<NotFoundPage />), path: "*" },
] satisfies RouteObject[];

export function AppRoutes(): ReactNode {
  const routes = useRoutes(appRoutes);
  return routes;
}
