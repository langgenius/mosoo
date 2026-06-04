import type { AccountProfile } from "@mosoo/contracts/account";
import type {
  OrganizationCreationSlotStatus,
  OrganizationInvitation,
  OrganizationSummary,
} from "@mosoo/contracts/organization";
import { createContext, useCallback, useMemo, use } from "react";
import type { ReactNode } from "react";

import { setActiveOrganization as setActiveOrganizationRemote } from "@/domains/organization/api/organization-client";
import { useViewerQuery } from "@/domains/user/query/user-queries";
import { toOrganizationId } from "@/routes/typed-id";

import { usePendingOrganizationInvitationsState } from "./use-pending-organization-invitations";

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
  onboardingState: OnboardingState | null;
  organizationCreationSlot: OrganizationCreationSlotStatus;
  organizations: OrganizationSummary[];
  organizationsLoading: boolean;
  pendingInvitations: OrganizationInvitation[];
  pendingInvitationsLoading: boolean;
  refreshOnboardingState(): Promise<boolean>;
  refreshOrganizations(): Promise<OrganizationSummary[]>;
  refreshPendingInvitations(): Promise<OrganizationInvitation[]>;
  setActiveOrganizationId(organizationId: string): Promise<void>;
  user: SessionUser | null;
  userLoading: boolean;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);
const DEFAULT_ORGANIZATION_CREATION_SLOT: OrganizationCreationSlotStatus = {
  occupied: false,
  organizationId: null,
};
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
  const pendingInvitationsState = usePendingOrganizationInvitationsState(user?.id ?? null);
  const memberships = viewer?.memberships;
  const organizations = useMemo(
    () => memberships?.map((membership) => membership.organization) ?? EMPTY_ORGANIZATIONS,
    [memberships],
  );
  const activeOrganization = viewer?.activeOrganization ?? null;
  const organizationCreationSlot =
    viewer?.organizationCreationSlot ?? DEFAULT_ORGANIZATION_CREATION_SLOT;
  const onboardingState = resolveOnboardingState({
    hasOrganizations: organizations.length > 0,
    loading: viewerQuery.isLoading,
    user,
  });

  const refetchViewer = viewerQuery.refetch;
  const refreshViewer = useCallback(async (): Promise<OrganizationSummary[]> => {
    const result = await refetchViewer();
    return result.data?.memberships.map((membership) => membership.organization) ?? [];
  }, [refetchViewer]);

  const refreshOnboardingState = useCallback(async (): Promise<boolean> => {
    const nextOrganizations = await refreshViewer();
    return nextOrganizations.length > 0;
  }, [refreshViewer]);

  const setActiveOrganizationId = useCallback(
    async (organizationId: string): Promise<void> => {
      await setActiveOrganizationRemote(toOrganizationId(organizationId));
      await refreshViewer();
    },
    [refreshViewer],
  );

  const value = useMemo<AppSessionContextValue>(
    () => ({
      activeOrganization,
      activeOrganizationId: activeOrganization?.id ?? null,
      onboardingState,
      organizationCreationSlot,
      organizations,
      organizationsLoading: viewerQuery.isLoading,
      pendingInvitations: pendingInvitationsState.pendingInvitations,
      pendingInvitationsLoading: pendingInvitationsState.loading,
      refreshOnboardingState,
      refreshOrganizations: refreshViewer,
      refreshPendingInvitations: pendingInvitationsState.refresh,
      setActiveOrganizationId,
      user,
      userLoading: viewerQuery.isLoading,
    }),
    [
      activeOrganization,
      onboardingState,
      organizationCreationSlot,
      organizations,
      pendingInvitationsState.loading,
      pendingInvitationsState.pendingInvitations,
      pendingInvitationsState.refresh,
      refreshOnboardingState,
      refreshViewer,
      setActiveOrganizationId,
      user,
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
