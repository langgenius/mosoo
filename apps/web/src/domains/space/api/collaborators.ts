import type { AccountId, SpaceId } from "@mosoo/contracts/id";
import type { Collaborator, SpaceRole } from "@mosoo/contracts/space";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId } from "@/routes/typed-id";

const SPACE_COLLABORATORS_QUERY = graphql(/* GraphQL */ `
  query SpaceCollaborators($spaceId: ULID!) {
    spaceCollaboratorList(spaceId: $spaceId) {
      assignedBy
      createdAt
      email
      imageUrl
      name
      principal
      role
    }
  }
`);

const ADD_COLLABORATOR_MUTATION = graphql(/* GraphQL */ `
  mutation AddCollaborator($input: AddCollaboratorInput!) {
    addCollaborator(input: $input) {
      principal
    }
  }
`);

const ADD_ORGANIZATION_COLLABORATOR_MUTATION = graphql(/* GraphQL */ `
  mutation AddOrganizationCollaborator($input: AddOrganizationCollaboratorInput!) {
    addOrganizationCollaborator(input: $input) {
      principal
    }
  }
`);

const UPDATE_COLLABORATOR_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateCollaborator($input: UpdateCollaboratorInput!) {
    updateCollaborator(input: $input) {
      principal
    }
  }
`);

const REMOVE_COLLABORATOR_MUTATION = graphql(/* GraphQL */ `
  mutation RemoveCollaborator($input: RemoveCollaboratorInput!) {
    removeCollaborator(input: $input) {
      ok
    }
  }
`);

export async function getCollaborators(spaceId: SpaceId): Promise<Collaborator[]> {
  const payload = await requestGraphQL(SPACE_COLLABORATORS_QUERY, {
    spaceId,
  });

  return payload.spaceCollaboratorList.map((collaborator) => ({
    assignedBy: collaborator.assignedBy === null ? null : toAccountId(collaborator.assignedBy),
    createdAt: collaborator.createdAt,
    email: collaborator.email,
    imageUrl: collaborator.imageUrl,
    name: collaborator.name,
    principal: collaborator.principal,
    role: collaborator.role,
  }));
}

export async function addCollaborator(
  spaceId: SpaceId,
  data: { email: string; role: SpaceRole },
): Promise<{ ok: true }> {
  await requestGraphQL(ADD_COLLABORATOR_MUTATION, {
    input: {
      ...data,
      spaceId,
    },
  });

  return { ok: true };
}

export async function addOrganizationCollaborator(spaceId: SpaceId): Promise<{ ok: true }> {
  await requestGraphQL(ADD_ORGANIZATION_COLLABORATOR_MUTATION, {
    input: {
      spaceId,
    },
  });

  return { ok: true };
}

export async function updateCollaborator(
  spaceId: SpaceId,
  userId: AccountId,
  data: { role: SpaceRole },
): Promise<{ ok: true }> {
  await requestGraphQL(UPDATE_COLLABORATOR_MUTATION, {
    input: {
      role: data.role,
      spaceId,
      userId,
    },
  });

  return { ok: true };
}

export async function removeCollaborator(
  spaceId: SpaceId,
  principal: string,
): Promise<{ ok: true }> {
  await requestGraphQL(REMOVE_COLLABORATOR_MUTATION, {
    input: {
      principal,
      spaceId,
    },
  });

  return { ok: true };
}
