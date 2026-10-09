import type { OrganizationId } from "@mosoo/id";

export interface OrganizationSummary {
  createdAt: string;
  id: OrganizationId;
  name: string;
}

export interface RenameOrganizationInput {
  organizationId: OrganizationId;
  name: string;
}
