import type { OrganizationId } from "@mosoo/contracts/id";
import type { ProjectSummary, RenameProjectInput } from "@mosoo/contracts/project";

import { graphql } from "@/gql";
import type { ProjectListQuery, CreateProjectMutation, RenameProjectMutation } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toEnvironmentId, toProjectId } from "@/routes/typed-id";

const PROJECT_LIST_QUERY = graphql(/* GraphQL */ `
  query ProjectList($organizationId: ULID!) {
    projectList(organizationId: $organizationId) {
      createdAt
      defaultEnvironmentId
      id
      name
      ownerAccountId
    }
  }
`);

const CREATE_PROJECT_MUTATION = graphql(/* GraphQL */ `
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      createdAt
      defaultEnvironmentId
      id
      name
      ownerAccountId
    }
  }
`);

const RENAME_PROJECT_MUTATION = graphql(/* GraphQL */ `
  mutation RenameProject($input: RenameProjectInput!) {
    renameProject(input: $input) {
      createdAt
      defaultEnvironmentId
      id
      name
      ownerAccountId
    }
  }
`);

function toProjectSummary(
  project:
    | ProjectListQuery["projectList"][number]
    | CreateProjectMutation["createProject"]
    | RenameProjectMutation["renameProject"],
): ProjectSummary {
  return {
    ...project,
    defaultEnvironmentId:
      project.defaultEnvironmentId === null ? null : toEnvironmentId(project.defaultEnvironmentId),
    id: toProjectId(project.id),
    ownerAccountId: toAccountId(project.ownerAccountId),
  };
}

export async function listOrganizationProjects(
  organizationId: OrganizationId,
): Promise<ProjectSummary[]> {
  const payload = await requestGraphQL(PROJECT_LIST_QUERY, { organizationId });

  return payload.projectList.map(toProjectSummary);
}

export async function createProject(input: {
  name: string;
  organizationId: OrganizationId;
}): Promise<ProjectSummary> {
  const payload = await requestGraphQL(CREATE_PROJECT_MUTATION, { input });

  return toProjectSummary(payload.createProject);
}

export async function renameProject(input: RenameProjectInput): Promise<ProjectSummary> {
  const payload = await requestGraphQL(RENAME_PROJECT_MUTATION, { input });

  return toProjectSummary(payload.renameProject);
}
