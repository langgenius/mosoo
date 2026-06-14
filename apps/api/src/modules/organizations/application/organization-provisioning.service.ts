import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { organizationsTable, appsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, AppId } from "@mosoo/id";

import { runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { errorMessageChainIncludes } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import { DEFAULT_APP_NAME, DEFAULT_APP_SLUG } from "../../apps/application/app-defaults";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createAppEnvironmentDefaults } from "../../environments/application/environment.service";
import { recordLastActiveOrganization } from "../../users/application/account-organization-context.service";
import { deriveOrganizationSlugBase } from "../domain/organization-name";
import { toOrganizationSummary } from "../domain/organization-ownership.policy";

interface ProvisionOrganizationWithOwnerInput {
  makeActive: boolean;
  name: string;
}

interface ProvisionOrganizationWriteInput {
  name: string;
  defaultAppId: AppId;
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
      name: input.name,
      slug: input.slug,
      updatedAt: input.timestampMs,
    }),
    db.insert(appsTable).values({
      createdAt: input.timestampMs,
      id: input.defaultAppId,
      name: DEFAULT_APP_NAME,
      organizationId: input.organizationId,
      ownerAccountId: input.ownerId,
      slug: DEFAULT_APP_SLUG,
      updatedAt: input.timestampMs,
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
  const defaultAppId: AppId = createPlatformId();
  const slugBase = deriveOrganizationSlugBase(input.name);
  let slug: string | null = null;

  for (let attempt = 1; attempt <= MAX_ORGANIZATION_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = deriveOrganizationSlugCandidate(slugBase, attempt);

    try {
      await writeOrganizationWithOwner(database, {
        name: input.name,
        defaultAppId,
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

  await createAppEnvironmentDefaults(
    { DB: database },
    {
      actorId: owner.id,
      organizationId,
      appId: defaultAppId,
      timestampMs,
    },
  );

  if (input.makeActive) {
    await recordLastActiveOrganization(database, owner.id, organizationId);
  }

  return toOrganizationSummary({
    avatar_url: null,
    created_at: timestampMs,
    id: organizationId,
    name: input.name,
    slug,
  });
}
