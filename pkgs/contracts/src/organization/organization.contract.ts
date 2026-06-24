import type { OrganizationId } from "../id/id.contract";

export interface OrganizationSummary {
  avatarUrl: string | null;
  createdAt: string;
  id: OrganizationId;
  name: string;
}

export interface RenameOrganizationInput {
  organizationId: OrganizationId;
  name: string;
}
