import type { BootstrapOnboardingInput, OnboardingStatus } from "@mosoo/contracts/account";
import { organizationsTable } from "@mosoo/db";
import { desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { provisionOrganizationWithOwner } from "../../organizations/application/organization-provisioning.service";
import { normalizeOrganizationName } from "../../organizations/domain/organization-name";
import { toOrganizationSummary } from "../../organizations/domain/organization-ownership.policy";
import { deriveOrgName } from "../../users/domain/user-account.policy";

function resolveOnboardingOrganizationName(
  viewer: AuthenticatedViewer,
  input: BootstrapOnboardingInput,
): string {
  const requestedName = input.name?.trim();

  if (requestedName) {
    return normalizeOrganizationName(requestedName);
  }

  return deriveOrgName(viewer.email, viewer.name);
}

export async function getOnboardingStatus(
  database: D1Database,
  viewer: AuthenticatedViewer | null,
): Promise<OnboardingStatus> {
  if (!viewer) {
    return {
      completed: false,
      organization: null,
    };
  }

  const row =
    (await getAppDatabase(database)
      .select({
        avatar_url: organizationsTable.avatarUrl,
        created_at: organizationsTable.createdAt,
        id: organizationsTable.id,
        name: organizationsTable.name,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.creatorAccountId, viewer.id))
      .orderBy(desc(organizationsTable.createdAt))
      .limit(1)
      .get()) ?? null;

  return {
    completed: row !== null,
    organization: row === null ? null : toOrganizationSummary(row),
  };
}

export async function bootstrapOnboarding(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: BootstrapOnboardingInput,
): Promise<OnboardingStatus> {
  const currentStatus = await getOnboardingStatus(database, viewer);

  if (currentStatus.completed) {
    return currentStatus;
  }

  const organizationName = resolveOnboardingOrganizationName(viewer, input);

  const organization = await provisionOrganizationWithOwner(database, viewer, {
    makeActive: true,
    name: organizationName,
  });

  return {
    completed: true,
    organization,
  };
}
