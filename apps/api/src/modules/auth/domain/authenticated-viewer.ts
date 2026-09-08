import type { AccountId, ProjectId, PersonalAccessTokenId } from "@mosoo/id";

export interface AuthenticatedViewer {
  apiKeyId?: PersonalAccessTokenId;
  /** Present only for an application Project key; never discard before authorization. */
  projectId?: ProjectId;
  email: string;
  emailVerified: boolean;
  id: AccountId;
  imageUrl: string | null;
  name: string;
}
