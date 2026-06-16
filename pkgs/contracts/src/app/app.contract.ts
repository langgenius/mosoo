import type { AccountId, EnvironmentId, AppId } from "../id/id.contract";

export interface AppSummary {
  createdAt: string;
  defaultEnvironmentId: EnvironmentId | null;
  id: AppId;
  name: string;
  ownerAccountId: AccountId;
}

export interface RenameAppInput {
  appId: AppId;
  name: string;
}
