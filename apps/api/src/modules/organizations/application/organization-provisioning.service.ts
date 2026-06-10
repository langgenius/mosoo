import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { organizationMembersTable, organizationsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId } from "@mosoo/id";

import { runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { errorMessageChainIncludes } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createOrganizationEnvironmentDefaults } from "../../environments/application/environment.service";
import { recordLastActiveOrganization } from "../../users/application/account-organization-context.service";
import { toOrganizationSummaryWithViewerRole } from "../domain/organization-access.policy";
import { deriveOrganizationSlugBase } from "../domain/organization-name";

interface ProvisionOrganizationWithOwnerInput {
  makeActive: boolean;
  name: string;
}

interface ProvisionOrganizationWriteInput {
  joinPolicy: "auto" | "invite_only";
  name: string;
  organizationId: OrganizationId;
  ownerId: AccountId;
  slug: string;
  timestampMs: number;
}

const MAX_ORGANIZATION_SLUG_ATTEMPTS = 999;

function deriveOrganizationSlugCandidate(slugBase: string, attempt: number): string {
  return attempt === 1 ? slugBase : `${slugBase}-${attempt}`;
}

function isOrganizationSlugConflict(error: unknown): boolean {
  return errorMessageChainIncludes(error, ["organization_slug_idx", "organization.slug"]);
}

async function writeOrganizationWithOwner(
  database: D1Database,
  input: ProvisionOrganizationWriteInput,
): Promise<void> {
  await runAppDatabaseBatch(database, (db) => [
    db.insert(organizationsTable).values({
      createdAt: input.timestampMs,
      creatorAccountId: input.ownerId,
      id: input.organizationId,
      joinPolicy: input.joinPolicy,
      name: input.name,
      primaryDomain: null,
      slug: input.slug,
      updatedAt: input.timestampMs,
    }),
    db.insert(organizationMembersTable).values({
      accountId: input.ownerId,
      createdAt: input.timestampMs,
      joinedAt: input.timestampMs,
      organizationId: input.organizationId,
      role: "owner",
    }),
  ]);
}

export async function provisionOrganizationWithOwner(
  database: D1Database,
  owner: AuthenticatedViewer,
  input: ProvisionOrganizationWithOwnerInput,
): Promise<OrganizationSummary> {
  const timestampMs = currentTimestampMs();
  const organizationId: OrganizationId = createPlatformId();
  const slugBase = deriveOrganizationSlugBase(input.name);
  const joinPolicy = "auto";
  let slug: string | null = null;

  for (let attempt = 1; attempt <= MAX_ORGANIZATION_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = deriveOrganizationSlugCandidate(slugBase, attempt);

    try {
      await writeOrganizationWithOwner(database, {
        joinPolicy,
        name: input.name,
        organizationId,
        ownerId: owner.id,
        slug: candidate,
        timestampMs,
      });
      slug = candidate;
      break;
    } catch (error) {
      if (isOrganizationSlugConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  if (slug === null) {
    throw new Error("Could not allocate organization slug.");
  }

  await createOrganizationEnvironmentDefaults(
    { DB: database },
    {
      actorId: owner.id,
      organizationId,
      timestampMs,
    },
  );

  if (input.makeActive) {
    await recordLastActiveOrganization(database, owner.id, organizationId);
  }

  return toOrganizationSummaryWithViewerRole(
    {
      avatar_url: null,
      created_at: timestampMs,
      id: organizationId,
      join_policy: joinPolicy,
      name: input.name,
      primary_domain: null,
      slug,
    },
    "owner",
  );
}
