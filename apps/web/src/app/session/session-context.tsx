import type { OrganizationSummary } from "@mosoo/contracts/organization";
import type { ProjectSummary } from "@mosoo/contracts/project";
import type { AccountId, OrganizationId, ProjectId } from "@mosoo/id";
import { createContext, useCallback, useMemo, useState, use } from "react";
import type { ReactNode } from "react";

import { useOrganizationProjectsQuery } from "@/domains/project/query/project-queries";
import { useViewerQuery } from "@/domains/user/query/user-queries";

import { resolveActiveProject } from "./active-project";

const SELECTED_PROJECT_STORAGE_KEY = "mosoo:selected-project";

function readSelectedProjectId(): string | null {
  try {
    return globalThis.localStorage?.getItem(SELECTED_PROJECT_STORAGE_KEY) ?? null;
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

export interface SessionUser {
  email: string;
  id: AccountId;
  image?: string | null;
  name: string;
}

interface AppSessionContextValue {
  activeOrganization: OrganizationSummary | null;
  activeOrganizationId: OrganizationId | null;
  activeProject: ProjectSummary | null;
  activeProjectId: ProjectId | null;
  hasOrganization: boolean;
  projects: ProjectSummary[];
  projectsLoading: boolean;
  refreshOrganizations(): Promise<void>;
  setActiveProject(projectId: ProjectId): void;
  user: SessionUser | null;
  userLoading: boolean;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);
const EMPTY_PROJECTS: ProjectSummary[] = [];

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const viewerQuery = useViewerQuery();
  const viewer = viewerQuery.data ?? null;
  const account = viewer?.account ?? null;
  const activeOrganization = viewer?.activeOrganization ?? null;
  const projectsQuery = useOrganizationProjectsQuery(activeOrganization?.id ?? null);
  const projects =
    activeOrganization === null ? EMPTY_PROJECTS : (projectsQuery.data ?? EMPTY_PROJECTS);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(readSelectedProjectId);
  const activeProject = resolveActiveProject(projects, selectedProjectId);
  const setActiveProject = useCallback((projectId: ProjectId) => {
    setSelectedProjectId(projectId);
    writeSelectedProjectId(projectId);
  }, []);
  const refetchViewer = viewerQuery.refetch;
  const refreshOrganizations = useCallback(async (): Promise<void> => {
    await refetchViewer();
  }, [refetchViewer]);
  const user = useMemo<SessionUser | null>(
    () =>
      account === null
        ? null
        : { email: account.email, id: account.id, image: account.imageUrl, name: account.name },
    [account],
  );

  const value: AppSessionContextValue = {
    activeOrganization,
    activeOrganizationId: activeOrganization?.id ?? null,
    activeProject,
    activeProjectId: activeProject?.id ?? null,
    hasOrganization: (viewer?.organizations.length ?? 0) > 0,
    projects,
    projectsLoading: projectsQuery.isLoading,
    refreshOrganizations,
    setActiveProject,
    user,
    userLoading: viewerQuery.isLoading,
  };

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
  const value = use(AppSessionContext);

  if (!value) {
    throw new Error("useAppSession must be used within AppSessionProvider.");
  }

  return value;
}

// Project-scoped routes render behind the active-Project gate in the route
// registry, so there the active Project is always set.
export function useActiveProject(): ProjectSummary {
  const { activeProject } = useAppSession();

  if (activeProject === null) {
    throw new Error("useActiveProject must be used within a Project route.");
  }

  return activeProject;
}
