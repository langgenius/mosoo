import type { ProjectSummary, RenameProjectInput } from "@mosoo/contracts/project";
import type { AccountId, EnvironmentId, OrganizationId, ProjectId } from "@mosoo/id";

import { graphql } from "@/gql";
import type { ProjectFieldsFragment } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

const PROJECT_FIELDS = graphql(/* GraphQL */ `
  fragment ProjectFields on Project {
    createdAt
    defaultEnvironmentId
    id
    name
    ownerAccountId
  }
`);

void PROJECT_FIELDS;

const PROJECT_LIST_QUERY = graphql(/* GraphQL */ `
  query ProjectList($organizationId: ULID!) {
    projectList(organizationId: $organizationId) {
      ...ProjectFields
    }
  }
`);

const CREATE_PROJECT_MUTATION = graphql(/* GraphQL */ `
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      ...ProjectFields
    }
  }
`);

const RENAME_PROJECT_MUTATION = graphql(/* GraphQL */ `
  mutation RenameProject($input: RenameProjectInput!) {
    renameProject(input: $input) {
      ...ProjectFields
    }
  }
`);

function toProjectSummary(project: ProjectFieldsFragment): ProjectSummary {
  return {
    ...project,
    defaultEnvironmentId: project.defaultEnvironmentId as EnvironmentId | null,
    id: project.id as ProjectId,
    ownerAccountId: project.ownerAccountId as AccountId,
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
