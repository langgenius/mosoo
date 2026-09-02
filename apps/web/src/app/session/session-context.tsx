import type { AccountProfile } from "@mosoo/contracts/account";
import type { OrganizationSummary } from "@mosoo/contracts/organization";
import type { ProjectSummary } from "@mosoo/contracts/project";
import { createContext, useCallback, useMemo, useState, use } from "react";
import type { ReactNode } from "react";

import { useOrganizationProjectsQuery } from "@/domains/project/query/project-queries";
import { useViewerQuery } from "@/domains/user/query/user-queries";

import { resolveActiveProject } from "./active-project";

export type OnboardingState = "complete" | "loading" | "pending";

const SELECTED_PROJECT_STORAGE_KEY = "mosoo:selected-project";
// Key written before the App -> Project rename; read-only fallback so an
// existing selection survives the rename.
const LEGACY_SELECTED_APP_STORAGE_KEY = "mosoo:selected-app";

function readSelectedProjectId(): string | null {
  try {
    return (
      globalThis.localStorage?.getItem(SELECTED_PROJECT_STORAGE_KEY) ??
      globalThis.localStorage?.getItem(LEGACY_SELECTED_APP_STORAGE_KEY) ??
      null
    );
  } catch {
    return null;
  }
}

function writeSelectedProjectId(projectId: string): void {
  try {
    globalThis.localStorage?.setItem(SELECTED_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

interface SessionUser {
  email: string;
  id: string;
  image?: string | null;
  name: string;
}

interface AppSessionContextValue {
  activeOrganization: OrganizationSummary | null;
  activeOrganizationId: string | null;
  activeProject: ProjectSummary | null;
  activeProjectId: string | null;
  onboardingState: OnboardingState | null;
  organizations: OrganizationSummary[];
  organizationsLoading: boolean;
  projects: ProjectSummary[];
  projectsLoading: boolean;
  refreshOnboardingState(): Promise<boolean>;
  refreshOrganizations(): Promise<OrganizationSummary[]>;
  setActiveProject(projectId: string): void;
  user: SessionUser | null;
  userLoading: boolean;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);
const EMPTY_PROJECTS: ProjectSummary[] = [];
const EMPTY_ORGANIZATIONS: OrganizationSummary[] = [];

function toSessionUser(account: AccountProfile | null): SessionUser | null {
  if (!account) {
    return null;
  }

  return {
    email: account.email,
    id: account.id,
    image: account.imageUrl,
    name: account.name,
  };
}

function resolveOnboardingState(input: {
  hasOrganizations: boolean;
  loading: boolean;
  user: SessionUser | null;
}): OnboardingState | null {
  if (input.loading) {
    return "loading";
  }

  if (!input.user) {
    return null;
  }

  return input.hasOrganizations ? "complete" : "pending";
}

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const viewerQuery = useViewerQuery();
  const viewer = viewerQuery.data ?? null;
  const user = toSessionUser(viewer?.account ?? null);
  const organizations = useMemo(() => viewer?.organizations ?? EMPTY_ORGANIZATIONS, [viewer]);
  const activeOrganization = viewer?.activeOrganization ?? null;
  const projectsQuery = useOrganizationProjectsQuery(activeOrganization?.id ?? null);
  const projects =
    activeOrganization === null ? EMPTY_PROJECTS : (projectsQuery.data ?? EMPTY_PROJECTS);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(readSelectedProjectId);
  const activeProject = resolveActiveProject(projects, selectedProjectId);
  const setActiveProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    writeSelectedProjectId(projectId);
  }, []);
  const onboardingState = resolveOnboardingState({
    hasOrganizations: organizations.length > 0,
    loading: viewerQuery.isLoading,
    user,
  });

  const refetchViewer = viewerQuery.refetch;
  const refreshViewer = useCallback(async (): Promise<OrganizationSummary[]> => {
    const result = await refetchViewer();
    return result.data?.organizations ?? [];
  }, [refetchViewer]);

  const refreshOnboardingState = useCallback(async (): Promise<boolean> => {
    const nextOrganizations = await refreshViewer();
    return nextOrganizations.length > 0;
  }, [refreshViewer]);

  const value = useMemo<AppSessionContextValue>(
    () => ({
      activeOrganization,
      activeOrganizationId: activeOrganization?.id ?? null,
      activeProject,
      activeProjectId: activeProject?.id ?? null,
      onboardingState,
      organizations,
      organizationsLoading: viewerQuery.isLoading,
      projects,
      projectsLoading: projectsQuery.isLoading,
      refreshOnboardingState,
      refreshOrganizations: refreshViewer,
      setActiveProject,
      user,
      userLoading: viewerQuery.isLoading,
    }),
    [
      activeOrganization,
      activeProject,
      onboardingState,
      organizations,
      refreshOnboardingState,
      refreshViewer,
      setActiveProject,
      user,
      projects,
      projectsQuery.isLoading,
      viewerQuery.isLoading,
    ],
  );

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
  const value = use(AppSessionContext);

  if (!value) {
    throw new Error("useAppSession must be used within AppSessionProvider.");
  }

  return value;
}
