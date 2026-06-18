import type { FileUploadSummary } from "@mosoo/contracts/file";
import type { FileId, AppId, SessionId } from "@mosoo/contracts/id";
import type { SessionResource } from "@mosoo/contracts/session";

import { graphql } from "@/gql";
import type { AddSessionResourceMutation, ListSessionResourcesQuery } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toFileId, toAppId, toSessionId } from "@/routes/typed-id";

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
  query ListSessionResources($appId: ULID!, $sessionId: ULID!) {
    listSessionResources(appId: $appId, sessionId: $sessionId) {
      createdAt
      id
      kind
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

export function sessionResourcesQueryKey(
  appId: AppId | null,
  sessionId: SessionId | null,
): readonly unknown[] {
  return ["session-resources", appId, sessionId];
}

function requireFileScopeId(id: string | null, kind: string): string {
  if (id === null) {
    throw new Error(`File scope ${kind} must include an id.`);
  }

  return id;
}

function toFileUploadScope(
  scope: AddSessionResourceMutation["addSessionResource"]["scope"],
): FileUploadSummary["scope"] {
  switch (scope.kind) {
    case "agent_package":
    case "app_draft":
      return { id: toAppId(requireFileScopeId(scope.id, scope.kind)), kind: scope.kind };
    case "library":
      return { id: null, kind: scope.kind };
    case "session":
      return { id: toSessionId(requireFileScopeId(scope.id, scope.kind)), kind: scope.kind };
  }
}

function toFileUploadOwner(
  owner: AddSessionResourceMutation["addSessionResource"]["owner"],
): FileUploadSummary["owner"] {
  switch (owner.kind) {
    case "account":
      return { id: toAccountId(owner.id), kind: owner.kind };
    case "app":
      return { id: toAppId(owner.id), kind: owner.kind };
    case "session":
      return { id: toSessionId(owner.id), kind: owner.kind };
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
    kind: resource.kind,
    mimeType: resource.mimeType,
    name: resource.name,
    path: resource.path,
    size: resource.size,
  };
}

export async function addSessionResourceUpload(
  appId: AppId,
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
      appId,
      sessionId,
    },
  });

  return toFileUploadSummary(payload.addSessionResource);
}

export async function listSessionResources(
  appId: AppId,
  sessionId: SessionId,
): Promise<SessionResource[]> {
  const payload = await requestGraphQL(LIST_SESSION_RESOURCES_QUERY, {
    appId,
    sessionId,
  });

  return payload.listSessionResources.map(toSessionResource);
}

export async function removeSessionResource(
  appId: AppId,
  sessionId: SessionId,
  resourceId: FileId,
): Promise<void> {
  await requestGraphQL(REMOVE_SESSION_RESOURCE_MUTATION, {
    input: {
      appId,
      resourceId,
      sessionId,
    },
  });
}
