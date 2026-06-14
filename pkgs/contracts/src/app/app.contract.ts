import type { AccountId, EnvironmentId, OrganizationId, AppId } from "../id/id.contract";

export interface AppSummary {
  createdAt: string;
  defaultEnvironmentId: EnvironmentId | null;
  id: AppId;
  name: string;
  organizationId: OrganizationId;
  ownerAccountId: AccountId;
  slug: string;
}
