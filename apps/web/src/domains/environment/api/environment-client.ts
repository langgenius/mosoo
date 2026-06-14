import type {
  CreateEnvironmentForkInput,
  CreateEnvironmentInput,
  DeleteEnvironmentInput,
  EnvironmentDetail,
  EnvironmentSummary,
  SetAppDefaultEnvironmentInput,
  UpdateEnvironmentInput,
} from "@mosoo/contracts/environment";
import type { EnvironmentId, AppId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type {
  EnvironmentDetailFieldsFragment,
  EnvironmentSummaryFieldsFragment,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toEnvironmentId, toEnvironmentRevisionId, toAppId } from "@/routes/typed-id";

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
    appId
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
    updatedAt
    usedByAgentCount
    appId
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([
  ENVIRONMENT_DETAIL_FIELDS,
  ENVIRONMENT_ENV_VAR_FIELDS,
  ENVIRONMENT_OWNER_FIELDS,
  ENVIRONMENT_PACKAGE_FIELDS,
  ENVIRONMENT_SUMMARY_FIELDS,
]);

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
    owner: {
      ...environment.owner,
      id: environment.owner.id === null ? null : toAccountId(environment.owner.id),
    },
    appId: toAppId(environment.appId),
  };
}

function toEnvironmentDetail(environment: EnvironmentDetailFieldsFragment): EnvironmentDetail {
  return toEnvironmentSummary(environment);
}

const LIST_ENVIRONMENTS_QUERY = graphql(/* GraphQL */ `
  query AppEnvironments($appId: ULID!) {
    appEnvironmentList(appId: $appId) {
      ...EnvironmentSummaryFields
    }
  }
`);

const GET_ENVIRONMENT_QUERY = graphql(/* GraphQL */ `
  query EnvironmentDetail($appId: ULID!, $environmentId: ULID!) {
    environment(appId: $appId, environmentId: $environmentId) {
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

const SET_APP_DEFAULT_ENVIRONMENT_MUTATION = graphql(/* GraphQL */ `
  mutation SetAppDefaultEnvironment($input: SetAppDefaultEnvironmentInput!) {
    setAppDefaultEnvironment(input: $input) {
      ...EnvironmentSummaryFields
    }
  }
`);

export async function listAppEnvironments(appId: AppId): Promise<EnvironmentSummary[]> {
  const payload = await requestGraphQL(LIST_ENVIRONMENTS_QUERY, { appId });
  return payload.appEnvironmentList.map(toEnvironmentSummary);
}

export async function getEnvironment(
  appId: AppId,
  environmentId: EnvironmentId,
): Promise<EnvironmentDetail> {
  const payload = await requestGraphQL(GET_ENVIRONMENT_QUERY, { environmentId, appId });
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

export async function setAppDefaultEnvironment(
  input: SetAppDefaultEnvironmentInput,
): Promise<EnvironmentSummary> {
  const payload = await requestGraphQL(SET_APP_DEFAULT_ENVIRONMENT_MUTATION, { input });
  return toEnvironmentSummary(payload.setAppDefaultEnvironment);
}
