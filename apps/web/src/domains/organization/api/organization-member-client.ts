import type { AccountId, OrganizationId } from "@mosoo/contracts/id";
import type { OrganizationMember, OrganizationMemberRole } from "@mosoo/contracts/organization";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toOrganizationMember } from "./organization-mappers";

const ORGANIZATION_MEMBERS_QUERY = graphql(/* GraphQL */ `
  query OrganizationMembers($organizationId: ULID!) {
    organizationMemberList(organizationId: $organizationId) {
      accountId
      email
      imageUrl
      joinedAt
      name
      role
      status
      disabledAt
      disabledByAccountId
    }
  }
`);

const UPDATE_MEMBER_ROLE_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateOrganizationMemberRole($input: UpdateOrganizationMemberRoleInput!) {
    updateOrganizationMemberRole(input: $input) {
      accountId
    }
  }
`);

const REMOVE_MEMBER_MUTATION = graphql(/* GraphQL */ `
  mutation RemoveOrganizationMember($input: RemoveOrganizationMemberInput!) {
    removeOrganizationMember(input: $input) {
      ok
    }
  }
`);

export async function organizationMembers(
  organizationId: OrganizationId,
): Promise<OrganizationMember[]> {
  const payload = await requestGraphQL(ORGANIZATION_MEMBERS_QUERY, {
    organizationId,
  });

  return payload.organizationMemberList.map(toOrganizationMember);
}

export async function updateMemberRole(
  organizationId: OrganizationId,
  accountId: AccountId,
  role: OrganizationMemberRole,
): Promise<{ ok: true }> {
  await requestGraphQL(UPDATE_MEMBER_ROLE_MUTATION, {
    input: {
      accountId,
      organizationId,
      role,
    },
  });

  return { ok: true as const };
}

export async function removeMember(
  organizationId: OrganizationId,
  accountId: AccountId,
): Promise<{ ok: true }> {
  await requestGraphQL(REMOVE_MEMBER_MUTATION, {
    input: {
      accountId,
      organizationId,
    },
  });

  return { ok: true as const };
}
