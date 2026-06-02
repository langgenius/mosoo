import type {
  CreateEnvironmentForkInput,
  CreateEnvironmentInput,
  DeleteEnvironmentInput,
  EnvironmentDetail,
  EnvironmentShareTarget,
  EnvironmentSummary,
  SetOrganizationDefaultEnvironmentInput,
  ShareEnvironmentWithOrganizationInput,
  ShareEnvironmentWithUserInput,
  UnshareEnvironmentTargetInput,
  UpdateEnvironmentInput,
} from "@mosoo/contracts/environment";
import type { EnvironmentId, OrganizationId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type {
  EnvironmentDetailFieldsFragment,
  EnvironmentShareTargetFieldsFragment,
  EnvironmentSummaryFieldsFragment,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import {
  toAccountId,
  toEnvironmentId,
  toEnvironmentRevisionId,
  toOrganizationId,
} from "@/routes/typed-id";

const ENVIRONMENT_PACKAGE_FIELDS = graphql(/* GraphQL */ `
  fragment EnvironmentPackageFields on EnvironmentPackageSpec {
    manager
    packages
  }
`);

const ENVIRONMENT_ENV_VAR_FIELDS = graphql(/* GraphQL */ `
  fragment EnvironmentVariableFields on EnvironmentVariablePreview {
    key
    preview
    status
  }
`);

const ENVIRONMENT_OWNER_FIELDS = graphql(/* GraphQL */ `
  fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
    id
    imageUrl
    name
  }
`);

const ENVIRONMENT_SUMMARY_FIELDS = graphql(/* GraphQL */ `
  fragment EnvironmentSummaryFields on EnvironmentSummary {
    allowMcpServers
    allowPackageManagers
    allowedHosts
    canDelete
    canEdit
    createdAt
    currentRevisionId
    description
    envVars {
      ...EnvironmentVariableFields
    }
    forkOrigin {
      environmentId
      name
      ownerName
    }
    id
    isBuiltIn
    isDefault
    isEditable
    name
    networkPolicy
    owner {
      ...EnvironmentOwnerFields
    }
    packages {
      ...EnvironmentPackageFields
    }
    role
    setupScript
    updatedAt
    usedByAgentCount
    organizationId
  }
`);

const ENVIRONMENT_SHARE_TARGET_FIELDS = graphql(/* GraphQL */ `
  fragment EnvironmentShareTargetFields on EnvironmentShareTarget {
    createdAt
    email
    id
    kind
    name
  }
`);

const ENVIRONMENT_DETAIL_FIELDS = graphql(/* GraphQL */ `
  fragment EnvironmentDetailFields on EnvironmentDetail {
    allowMcpServers
    allowPackageManagers
    allowedHosts
    canDelete
    canEdit
    createdAt
    currentRevisionId
    description
    envVars {
      ...EnvironmentVariableFields
    }
    forkOrigin {
      environmentId
      name
      ownerName
    }
    id
    isBuiltIn
    isDefault
    isEditable
    name
    networkPolicy
    owner {
      ...EnvironmentOwnerFields
    }
    packages {
      ...EnvironmentPackageFields
    }
    role
    setupScript
    shareTargets {
      ...EnvironmentShareTargetFields
    }
    updatedAt
    usedByAgentCount
    organizationId
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([
  ENVIRONMENT_DETAIL_FIELDS,
  ENVIRONMENT_ENV_VAR_FIELDS,
  ENVIRONMENT_OWNER_FIELDS,
  ENVIRONMENT_PACKAGE_FIELDS,
  ENVIRONMENT_SHARE_TARGET_FIELDS,
  ENVIRONMENT_SUMMARY_FIELDS,
]);

function toEnvironmentShareTarget(
  target: EnvironmentShareTargetFieldsFragment,
): EnvironmentShareTarget {
  return {
    ...target,
    id: target.kind === "user" ? toAccountId(target.id) : toOrganizationId(target.id),
  };
}

function toEnvironmentSummary(environment: EnvironmentSummaryFieldsFragment): EnvironmentSummary {
  return {
    ...environment,
    currentRevisionId: toEnvironmentRevisionId(environment.currentRevisionId),
    forkOrigin:
      environment.forkOrigin === null
        ? null
        : {
            ...environment.forkOrigin,
            environmentId: toEnvironmentId(environment.forkOrigin.environmentId),
          },
    id: toEnvironmentId(environment.id),
    organizationId: toOrganizationId(environment.organizationId),
    owner: {
      ...environment.owner,
      id: environment.owner.id === null ? null : toAccountId(environment.owner.id),
    },
  };
}

function toEnvironmentDetail(environment: EnvironmentDetailFieldsFragment): EnvironmentDetail {
  return {
    ...toEnvironmentSummary(environment),
    shareTargets: environment.shareTargets.map(toEnvironmentShareTarget),
  };
}

const LIST_ENVIRONMENTS_QUERY = graphql(/* GraphQL */ `
  query OrganizationEnvironments($organizationId: ULID!) {
    organizationEnvironmentList(organizationId: $organizationId) {
      ...EnvironmentSummaryFields
    }
  }
`);

const GET_ENVIRONMENT_QUERY = graphql(/* GraphQL */ `
  query EnvironmentDetail($environmentId: ULID!) {
    environment(environmentId: $environmentId) {
      ...EnvironmentDetailFields
    }
  }
`);

const CREATE_ENVIRONMENT_MUTATION = graphql(/* GraphQL */ `
  mutation CreateEnvironment($input: CreateEnvironmentInput!) {
    createEnvironment(input: $input) {
      ...EnvironmentSummaryFields
    }
  }
`);

const UPDATE_ENVIRONMENT_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateEnvironment($input: UpdateEnvironmentInput!) {
    updateEnvironment(input: $input) {
      ...EnvironmentDetailFields
    }
  }
`);

const CREATE_ENVIRONMENT_FORK_MUTATION = graphql(/* GraphQL */ `
  mutation CreateEnvironmentFork($input: CreateEnvironmentForkInput!) {
    createEnvironmentFork(input: $input) {
      ...EnvironmentSummaryFields
    }
  }
`);

const DELETE_ENVIRONMENT_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {
    deleteEnvironment(input: $input) {
      ok
    }
  }
`);

const SET_ORG_DEFAULT_ENVIRONMENT_MUTATION = graphql(/* GraphQL */ `
  mutation SetOrganizationDefaultEnvironment($input: SetOrganizationDefaultEnvironmentInput!) {
    setOrganizationDefaultEnvironment(input: $input) {
      ...EnvironmentSummaryFields
    }
  }
`);

const SHARE_ENVIRONMENT_WITH_USER_MUTATION = graphql(/* GraphQL */ `
  mutation ShareEnvironmentWithUser($input: ShareEnvironmentWithUserInput!) {
    shareEnvironmentWithUser(input: $input) {
      ...EnvironmentShareTargetFields
    }
  }
`);

const SHARE_ENVIRONMENT_WITH_ORG_MUTATION = graphql(/* GraphQL */ `
  mutation ShareEnvironmentWithOrganization($input: ShareEnvironmentWithOrganizationInput!) {
    shareEnvironmentWithOrganization(input: $input) {
      ...EnvironmentShareTargetFields
    }
  }
`);

const UNSHARE_ENVIRONMENT_TARGET_MUTATION = graphql(/* GraphQL */ `
  mutation UnshareEnvironmentTarget($input: UnshareEnvironmentTargetInput!) {
    unshareEnvironmentTarget(input: $input) {
      ok
    }
  }
`);

export async function listOrganizationEnvironments(
  organizationId: OrganizationId,
): Promise<EnvironmentSummary[]> {
  const payload = await requestGraphQL(LIST_ENVIRONMENTS_QUERY, { organizationId });
  return payload.organizationEnvironmentList.map(toEnvironmentSummary);
}

export async function getEnvironment(environmentId: EnvironmentId): Promise<EnvironmentDetail> {
  const payload = await requestGraphQL(GET_ENVIRONMENT_QUERY, { environmentId });
  return toEnvironmentDetail(payload.environment);
}

export async function createEnvironment(
  input: CreateEnvironmentInput,
): Promise<EnvironmentSummary> {
  const payload = await requestGraphQL(CREATE_ENVIRONMENT_MUTATION, { input });
  return toEnvironmentSummary(payload.createEnvironment);
}

export async function updateEnvironment(input: UpdateEnvironmentInput): Promise<EnvironmentDetail> {
  const payload = await requestGraphQL(UPDATE_ENVIRONMENT_MUTATION, { input });
  return toEnvironmentDetail(payload.updateEnvironment);
}

export async function createEnvironmentFork(
  input: CreateEnvironmentForkInput,
): Promise<EnvironmentSummary> {
  const payload = await requestGraphQL(CREATE_ENVIRONMENT_FORK_MUTATION, { input });
  return toEnvironmentSummary(payload.createEnvironmentFork);
}

export async function deleteEnvironment(input: DeleteEnvironmentInput): Promise<void> {
  await requestGraphQL(DELETE_ENVIRONMENT_MUTATION, { input });
}

export async function setOrganizationDefaultEnvironment(
  input: SetOrganizationDefaultEnvironmentInput,
): Promise<EnvironmentSummary> {
  const payload = await requestGraphQL(SET_ORG_DEFAULT_ENVIRONMENT_MUTATION, { input });
  return toEnvironmentSummary(payload.setOrganizationDefaultEnvironment);
}

export async function shareEnvironmentWithUser(
  input: ShareEnvironmentWithUserInput,
): Promise<EnvironmentShareTarget> {
  const payload = await requestGraphQL(SHARE_ENVIRONMENT_WITH_USER_MUTATION, { input });
  return toEnvironmentShareTarget(payload.shareEnvironmentWithUser);
}

export async function shareEnvironmentWithOrganization(
  input: ShareEnvironmentWithOrganizationInput,
): Promise<EnvironmentShareTarget> {
  const payload = await requestGraphQL(SHARE_ENVIRONMENT_WITH_ORG_MUTATION, { input });
  return toEnvironmentShareTarget(payload.shareEnvironmentWithOrganization);
}

export async function unshareEnvironmentTarget(
  input: UnshareEnvironmentTargetInput,
): Promise<void> {
  await requestGraphQL(UNSHARE_ENVIRONMENT_TARGET_MUTATION, { input });
}
