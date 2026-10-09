import type {
  CreateEnvironmentInput,
  DeleteEnvironmentInput,
  EnvironmentDetail,
  EnvironmentSummary,
  SetProjectDefaultEnvironmentInput,
  UpdateEnvironmentInput,
} from "@mosoo/contracts/environment";
import type { EnvironmentId, EnvironmentRevisionId, ProjectId } from "@mosoo/id";

import { graphql } from "@/gql";
import type { EnvironmentSummaryFieldsFragment } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

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

const ENVIRONMENT_SUMMARY_FIELDS = graphql(/* GraphQL */ `
  fragment EnvironmentSummaryFields on EnvironmentSummary {
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
    name
    networkPolicy
    packages {
      ...EnvironmentPackageFields
    }
    setupScript
    updatedAt
    usedByAgentCount
    projectId
  }
`);

const ENVIRONMENT_DETAIL_FIELDS = graphql(/* GraphQL */ `
  fragment EnvironmentDetailFields on EnvironmentDetail {
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
    name
    networkPolicy
    packages {
      ...EnvironmentPackageFields
    }
    setupScript
    updatedAt
    usedByAgentCount
    projectId
  }
`);

void ENVIRONMENT_DETAIL_FIELDS;
void ENVIRONMENT_ENV_VAR_FIELDS;
void ENVIRONMENT_PACKAGE_FIELDS;
void ENVIRONMENT_SUMMARY_FIELDS;

function toEnvironmentSummary(environment: EnvironmentSummaryFieldsFragment): EnvironmentSummary {
  return {
    ...environment,
    currentRevisionId: environment.currentRevisionId as EnvironmentRevisionId,
    forkOrigin:
      environment.forkOrigin === null
        ? null
        : {
            ...environment.forkOrigin,
            environmentId: environment.forkOrigin.environmentId as EnvironmentId,
          },
    id: environment.id as EnvironmentId,
    projectId: environment.projectId as ProjectId,
  };
}

const LIST_ENVIRONMENTS_QUERY = graphql(/* GraphQL */ `
  query ProjectEnvironments($projectId: ULID!) {
    projectEnvironmentList(projectId: $projectId) {
      ...EnvironmentSummaryFields
    }
  }
`);

const GET_ENVIRONMENT_QUERY = graphql(/* GraphQL */ `
  query EnvironmentDetail($projectId: ULID!, $environmentId: ULID!) {
    environment(projectId: $projectId, environmentId: $environmentId) {
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

const DELETE_ENVIRONMENT_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {
    deleteEnvironment(input: $input) {
      ok
    }
  }
`);

const SET_PROJECT_DEFAULT_ENVIRONMENT_MUTATION = graphql(/* GraphQL */ `
  mutation SetProjectDefaultEnvironment($input: SetProjectDefaultEnvironmentInput!) {
    setProjectDefaultEnvironment(input: $input) {
      ...EnvironmentSummaryFields
    }
  }
`);

export async function listProjectEnvironments(projectId: ProjectId): Promise<EnvironmentSummary[]> {
  const payload = await requestGraphQL(LIST_ENVIRONMENTS_QUERY, { projectId });
  return payload.projectEnvironmentList.map(toEnvironmentSummary);
}

export async function getEnvironment(
  projectId: ProjectId,
  environmentId: EnvironmentId,
): Promise<EnvironmentDetail> {
  const payload = await requestGraphQL(GET_ENVIRONMENT_QUERY, { environmentId, projectId });
  return toEnvironmentSummary(payload.environment);
}

export async function createEnvironment(
  input: CreateEnvironmentInput,
): Promise<EnvironmentSummary> {
  const payload = await requestGraphQL(CREATE_ENVIRONMENT_MUTATION, { input });
  return toEnvironmentSummary(payload.createEnvironment);
}

export async function updateEnvironment(input: UpdateEnvironmentInput): Promise<EnvironmentDetail> {
  const payload = await requestGraphQL(UPDATE_ENVIRONMENT_MUTATION, { input });
  return toEnvironmentSummary(payload.updateEnvironment);
}

export async function deleteEnvironment(input: DeleteEnvironmentInput): Promise<void> {
  await requestGraphQL(DELETE_ENVIRONMENT_MUTATION, { input });
}

export async function setProjectDefaultEnvironment(
  input: SetProjectDefaultEnvironmentInput,
): Promise<EnvironmentSummary> {
  const payload = await requestGraphQL(SET_PROJECT_DEFAULT_ENVIRONMENT_MUTATION, { input });
  return toEnvironmentSummary(payload.setProjectDefaultEnvironment);
}
