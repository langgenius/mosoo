import type { AppSummary, RenameAppInput } from "@mosoo/contracts/app";
import type { OrganizationId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type { AppListQuery, RenameAppMutation } from "@/gql/graphql";
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

const RENAME_APP_MUTATION = graphql(/* GraphQL */ `
  mutation RenameApp($input: RenameAppInput!) {
    renameApp(input: $input) {
      createdAt
      defaultEnvironmentId
      id
      name
      ownerAccountId
      slug
    }
  }
`);

function toAppSummary(
  app: AppListQuery["appList"][number] | RenameAppMutation["renameApp"],
): AppSummary {
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

export async function renameApp(input: RenameAppInput): Promise<AppSummary> {
  const payload = await requestGraphQL(RENAME_APP_MUTATION, { input });

  return toAppSummary(payload.renameApp);
}
