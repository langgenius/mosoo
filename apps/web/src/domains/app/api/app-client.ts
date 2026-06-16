import type { AppSummary } from "@mosoo/contracts/app";
import type { OrganizationId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toEnvironmentId, toAppId } from "@/routes/typed-id";

const APP_LIST_QUERY = graphql(/* GraphQL */ `
  query AppList($organizationId: ULID!) {
    appList(organizationId: $organizationId) {
      createdAt
      defaultEnvironmentId
      id
      name
      ownerAccountId
    }
  }
`);

const CREATE_APP_MUTATION = graphql(/* GraphQL */ `
  mutation CreateApp($input: CreateAppInput!) {
    createApp(input: $input) {
      createdAt
      defaultEnvironmentId
      id
      name
      ownerAccountId
    }
  }
`);

interface AppFields {
  createdAt: string;
  defaultEnvironmentId: string | null;
  id: string;
  name: string;
  ownerAccountId: string;
}

function toAppSummary(app: AppFields): AppSummary {
  return {
    ...app,
    defaultEnvironmentId:
      app.defaultEnvironmentId === null ? null : toEnvironmentId(app.defaultEnvironmentId),
    id: toAppId(app.id),
    ownerAccountId: toAccountId(app.ownerAccountId),
  };
}

export async function listOrganizationApps(organizationId: OrganizationId): Promise<AppSummary[]> {
  const payload = await requestGraphQL(APP_LIST_QUERY, { organizationId });

  return payload.appList.map(toAppSummary);
}

export async function createApp(input: {
  name: string;
  organizationId: OrganizationId;
}): Promise<AppSummary> {
  const payload = await requestGraphQL(CREATE_APP_MUTATION, { input });

  return toAppSummary(payload.createApp);
}
