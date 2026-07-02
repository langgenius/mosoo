import type { FileUploadSummary } from "@mosoo/contracts/file";
import type { AppId, SessionId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import type { AddSessionResourceMutation } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toFileId } from "@/routes/typed-id";

const ADD_SESSION_RESOURCE_MUTATION = graphql(/* GraphQL */ `
  mutation AddSessionResource($input: AddSessionResourceInput!) {
    addSessionResource(input: $input) {
      contentType
      expectedSize
      expiresAt
      fileId
      partSize
      path
      status
      strategy
    }
  }
`);

export function sessionResourcesQueryKey(
  appId: AppId | null,
  sessionId: SessionId | null,
): readonly unknown[] {
  return ["session-resources", appId, sessionId];
}

function toFileUploadSummary(
  upload: AddSessionResourceMutation["addSessionResource"],
): FileUploadSummary {
  return {
    contentType: upload.contentType,
    expectedSize: upload.expectedSize,
    expiresAt: upload.expiresAt,
    fileId: toFileId(upload.fileId),
    partSize: upload.partSize,
    path: upload.path,
    status: upload.status,
    strategy: upload.strategy,
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
