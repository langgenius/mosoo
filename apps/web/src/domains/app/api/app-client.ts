import type { AppSummary } from "@mosoo/contracts/app";
import type { OrganizationId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type { AppListQuery } from "@/gql/graphql";
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
      slug
    }
  }
`);

function toAppSummary(app: AppListQuery["appList"][number]): AppSummary {
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
