import type { OrganizationId } from "../id/id.contract";

export interface OrganizationSummary {
  avatarUrl: string | null;
  createdAt: string;
  id: OrganizationId;
  name: string;
}
