import { useQuery } from "@tanstack/react-query";

import { toOrganizationId } from "../../../routes/typed-id";
import { isTruthy } from "../../../shared/lib/truthiness";
import {
  organizationMembers as listOrganizationMembers,
  pendingOrganizationInvitations,
} from "../api/organization-client";
export const organizationKeys = {
  all: ["organization"] as const,
  memberLists: () => [...organizationKeys.all, "members"] as const,
  members: (organizationId: string) => [...organizationKeys.memberLists(), organizationId] as const,
  pendingInvitationLists: () => [...organizationKeys.all, "pending-invitations"] as const,
  pendingInvitations: (userId: string) =>
    [...organizationKeys.pendingInvitationLists(), userId] as const,
};

export function usePendingOrganizationInvitationsQuery(userId: string | null) {
  return useQuery({
    enabled: userId !== null,
    queryFn: async () => pendingOrganizationInvitations(),
    queryKey: isTruthy(userId)
      ? organizationKeys.pendingInvitations(userId)
      : [...organizationKeys.pendingInvitationLists(), "missing"],
  });
}

export function useOrganizationMembersQuery(organizationId: string | null) {
  return useQuery({
    enabled: organizationId !== null,
    queryFn: async () => listOrganizationMembers(toOrganizationId(organizationId!)),
    queryKey: isTruthy(organizationId)
      ? organizationKeys.members(organizationId)
      : [...organizationKeys.memberLists(), "missing"],
  });
}
