import type { FileUploadSummary } from "@mosoo/contracts/file";
import type { FileId, SessionId } from "@mosoo/contracts/id";
import type { SessionResource } from "@mosoo/contracts/session";

import { graphql } from "@/gql";
import type { AddSessionResourceMutation, ListSessionResourcesQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toFileId, toOrganizationId, toSessionId, toSpaceId } from "@/routes/typed-id";

const ADD_SESSION_RESOURCE_MUTATION = graphql(/* GraphQL */ `
  mutation AddSessionResource($input: AddSessionResourceInput!) {
    addSessionResource(input: $input) {
      contentType
      expectedSize
      expiresAt
      fileId
      owner {
        id
        kind
      }
      partSize
      path
      purpose
      scope {
        id
        kind
      }
      status
      strategy
    }
  }
`);

const LIST_SESSION_RESOURCES_QUERY = graphql(/* GraphQL */ `
  query ListSessionResources($sessionId: ULID!) {
    listSessionResources(sessionId: $sessionId) {
      createdAt
      id
      mimeType
      name
      path
      size
    }
  }
`);

const REMOVE_SESSION_RESOURCE_MUTATION = graphql(/* GraphQL */ `
  mutation RemoveSessionResource($input: RemoveSessionResourceInput!) {
    removeSessionResource(input: $input) {
      ok
    }
  }
`);

export function sessionResourcesQueryKey(sessionId: SessionId | null): readonly unknown[] {
  return ["session-resources", sessionId];
}

function toFileUploadScope(
  scope: AddSessionResourceMutation["addSessionResource"]["scope"],
): FileUploadSummary["scope"] {
  switch (scope.kind) {
    case "agent_package":
    case "organization_avatar":
    case "organization_draft":
      return { id: toOrganizationId(scope.id), kind: scope.kind };
    case "session":
      return { id: toSessionId(scope.id), kind: scope.kind };
    case "space":
      return { id: toSpaceId(scope.id), kind: scope.kind };
  }
}

function toFileUploadOwner(
  owner: AddSessionResourceMutation["addSessionResource"]["owner"],
): FileUploadSummary["owner"] {
  switch (owner.kind) {
    case "account":
      return { id: toAccountId(owner.id), kind: owner.kind };
    case "organization":
      return { id: toOrganizationId(owner.id), kind: owner.kind };
    case "session":
      return { id: toSessionId(owner.id), kind: owner.kind };
    case "space":
      return { id: toSpaceId(owner.id), kind: owner.kind };
  }
}

function toFileUploadSummary(
  upload: AddSessionResourceMutation["addSessionResource"],
): FileUploadSummary {
  return {
    contentType: upload.contentType,
    expectedSize: upload.expectedSize,
    expiresAt: upload.expiresAt,
    fileId: toFileId(upload.fileId),
    owner: toFileUploadOwner(upload.owner),
    partSize: upload.partSize,
    path: upload.path,
    purpose: upload.purpose,
    scope: toFileUploadScope(upload.scope),
    status: upload.status,
    strategy: upload.strategy,
  };
}

function toSessionResource(
  resource: ListSessionResourcesQuery["listSessionResources"][number],
): SessionResource {
  return {
    createdAt: resource.createdAt,
    id: toFileId(resource.id),
    mimeType: resource.mimeType,
    name: resource.name,
    path: resource.path,
    size: resource.size,
  };
}

export async function addSessionResourceUpload(
  sessionId: SessionId,
  file: File,
): Promise<FileUploadSummary> {
  const payload = await requestGraphQL(ADD_SESSION_RESOURCE_MUTATION, {
    input: {
      file: {
        contentType: file.type || "application/octet-stream",
        name: file.name,
        size: file.size,
      },
      sessionId,
    },
  });

  return toFileUploadSummary(payload.addSessionResource);
}

export async function listSessionResources(sessionId: SessionId): Promise<SessionResource[]> {
  const payload = await requestGraphQL(LIST_SESSION_RESOURCES_QUERY, {
    sessionId,
  });

  return payload.listSessionResources.map(toSessionResource);
}

export async function removeSessionResource(
  sessionId: SessionId,
  resourceId: FileId,
): Promise<void> {
  await requestGraphQL(REMOVE_SESSION_RESOURCE_MUTATION, {
    input: {
      resourceId,
      sessionId,
    },
  });
}
