import type { OrganizationInvitation } from "@mosoo/contracts/organization";
import { useQueryClient } from "@tanstack/react-query";

import { pendingOrganizationInvitations } from "../../domains/organization/api/organization-client";
import {
  organizationKeys,
  usePendingOrganizationInvitationsQuery,
} from "../../domains/organization/query/organization-queries";
import { isTruthy } from "../../shared/lib/truthiness";
export function usePendingOrganizationInvitationsState(userId: string | null) {
  const queryClient = useQueryClient();
  const invitationsQuery = usePendingOrganizationInvitationsQuery(userId);

  async function refresh(): Promise<OrganizationInvitation[]> {
    if (!isTruthy(userId)) {
      return [];
    }

    await queryClient.invalidateQueries({ queryKey: organizationKeys.pendingInvitations(userId) });

    return queryClient.fetchQuery({
      queryFn: async () => pendingOrganizationInvitations(),
      queryKey: organizationKeys.pendingInvitations(userId),
    });
  }

  return {
    loading: userId !== null ? invitationsQuery.isLoading : false,
    pendingInvitations: invitationsQuery.data ?? [],
    refresh,
  };
}
