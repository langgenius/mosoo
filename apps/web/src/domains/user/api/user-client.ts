import type { Viewer } from "@mosoo/contracts/account";

import { graphql } from "@/gql";
import type { ViewerQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId } from "@/routes/typed-id";

import { toOrganizationSummary } from "../../organization/api/organization-mappers";

const VIEWER_QUERY = graphql(/* GraphQL */ `
  query Viewer {
    viewer {
      account {
        email
        id
        imageUrl
        name
        systemAgentModel {
          modelId
          vendor
        }
      }
      activeOrganization {
        avatarUrl
        createdAt
        id
        name
        slug
      }
      auth {
        currentSecurityLevel
        methods
      }
      organizations {
        avatarUrl
        createdAt
        id
        name
        slug
      }
    }
  }
`);

const UPDATE_PROFILE_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateProfile($input: UpdateAccountProfileInput!) {
    updateProfile(input: $input) {
      imageUrl
      name
    }
  }
`);

const SET_SYSTEM_AGENT_MODEL_MUTATION = graphql(/* GraphQL */ `
  mutation SetSystemAgentModel($input: SetSystemAgentModelInput!) {
    setSystemAgentModel(input: $input) {
      id
      systemAgentModel {
        modelId
        vendor
      }
    }
  }
`);

function toViewer(viewer: ViewerQuery["viewer"]): Viewer {
  return {
    ...viewer,
    account:
      viewer.account === null
        ? null
        : {
            ...viewer.account,
            id: toAccountId(viewer.account.id),
          },
    activeOrganization:
      viewer.activeOrganization === null ? null : toOrganizationSummary(viewer.activeOrganization),
    organizations: viewer.organizations.map(toOrganizationSummary),
  };
}

export async function getViewer(): Promise<Viewer> {
  const payload = await requestGraphQL(VIEWER_QUERY);
  return toViewer(payload.viewer);
}

export async function updateProfile(input: {
  imageUrl?: string | null;
  name: string;
}): Promise<{ imageUrl: string | null; name: string }> {
  const payload = await requestGraphQL(UPDATE_PROFILE_MUTATION, {
    input,
  });

  return {
    imageUrl: payload.updateProfile.imageUrl ?? null,
    name: payload.updateProfile.name,
  };
}

export async function setSystemAgentModel(input: {
  modelId: string;
  vendor: string;
}): Promise<{ modelId: string; vendor: string } | null> {
  const payload = await requestGraphQL(SET_SYSTEM_AGENT_MODEL_MUTATION, { input });
  return payload.setSystemAgentModel.systemAgentModel ?? null;
}
