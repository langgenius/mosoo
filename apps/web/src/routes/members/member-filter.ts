import type { OrganizationMember } from "@mosoo/contracts/organization";

import { isTruthy } from "../../shared/lib/truthiness";
export function filterOrganizationMembers({
  focusedMemberId,
  members,
  query,
}: {
  focusedMemberId: string | null;
  members: OrganizationMember[];
  query: string;
}): OrganizationMember[] {
  if (isTruthy(focusedMemberId)) {
    return members.filter((member) => member.accountId === focusedMemberId);
  }

  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return members;
  }

  return members.filter(
    (member) =>
      member.name?.toLowerCase().includes(normalizedQuery) ||
      member.email?.toLowerCase().includes(normalizedQuery),
  );
}
