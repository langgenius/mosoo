import type { AccountProfile } from "@mosoo/contracts/account";
import type { AppSummary } from "@mosoo/contracts/app";
import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { createContext, useCallback, useMemo, use } from "react";
import type { ReactNode } from "react";

import { useOrganizationAppsQuery } from "@/domains/app/query/app-queries";
import { useViewerQuery } from "@/domains/user/query/user-queries";

import { resolveActiveApp } from "./active-app";

export type OnboardingState = "complete" | "loading" | "pending";

interface SessionUser {
  email: string;
  id: string;
  image?: string | null;
  name: string;
}

interface AppSessionContextValue {
  activeOrganization: OrganizationSummary | null;
  activeOrganizationId: string | null;
  activeApp: AppSummary | null;
  activeAppId: string | null;
  onboardingState: OnboardingState | null;
  organizations: OrganizationSummary[];
  organizationsLoading: boolean;
  apps: AppSummary[];
  appsLoading: boolean;
  refreshOnboardingState(): Promise<boolean>;
  refreshOrganizations(): Promise<OrganizationSummary[]>;
  user: SessionUser | null;
  userLoading: boolean;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);
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
  const appsQuery = useOrganizationAppsQuery(activeOrganization?.id ?? null);
  const apps = activeOrganization === null ? [] : (appsQuery.data ?? []);
  const activeApp = resolveActiveApp(apps);
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
      activeApp,
      activeAppId: activeApp?.id ?? null,
      onboardingState,
      organizations,
      organizationsLoading: viewerQuery.isLoading,
      apps,
      appsLoading: appsQuery.isLoading,
      refreshOnboardingState,
      refreshOrganizations: refreshViewer,
      user,
      userLoading: viewerQuery.isLoading,
    }),
    [
      activeOrganization,
      activeApp,
      onboardingState,
      organizations,
      refreshOnboardingState,
      refreshViewer,
      user,
      apps,
      appsQuery.isLoading,
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
