import type {
  CreatePersonalAccessTokenResponse,
  PersonalAccessTokenListResponse,
} from "@mosoo/contracts/auth";
import type { PersonalAccessTokenId, ProjectId } from "@mosoo/id";

import { requestJson } from "@/platform/http/file-request";

export async function listPersonalAccessTokens(
  projectId: ProjectId,
): Promise<PersonalAccessTokenListResponse> {
  return requestJson(`/access-tokens?projectId=${encodeURIComponent(projectId)}`);
}

export async function createPersonalAccessToken(
  label: string,
  projectId: ProjectId,
): Promise<CreatePersonalAccessTokenResponse> {
  return requestJson("/access-tokens", {
    bodyJson: { label, projectId },
    method: "POST",
  });
}

export async function revokePersonalAccessToken(tokenId: PersonalAccessTokenId): Promise<void> {
  await requestJson(`/access-tokens/${tokenId}`, { method: "DELETE" });
}

export const personalAccessTokenKeys = {
  list: (projectId: ProjectId) => ["auth", "project-api-keys", projectId] as const,
};
