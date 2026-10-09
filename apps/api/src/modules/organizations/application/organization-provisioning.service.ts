import type { OrganizationSummary } from "@mosoo/contracts/organization";
import { organizationsTable, projectsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, ProjectId } from "@mosoo/id";

import { runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createProjectEnvironmentDefaults } from "../../environments/application/environment-defaults";
import { DEFAULT_PROJECT_NAME } from "../../projects/application/project-defaults";
import { toOrganizationSummary } from "../domain/organization-ownership.policy";

interface ProvisionOrganizationWriteInput {
  name: string;
  defaultProjectId: ProjectId;
  organizationId: OrganizationId;
  ownerId: AccountId;
  timestampMs: number;
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
      updatedAt: input.timestampMs,
    }),
    db.insert(projectsTable).values({
      createdAt: input.timestampMs,
      id: input.defaultProjectId,
      name: DEFAULT_PROJECT_NAME,
      organizationId: input.organizationId,
      ownerAccountId: input.ownerId,
      updatedAt: input.timestampMs,
    }),
  ]);
}

export async function provisionOrganizationWithOwner(
  database: D1Database,
  owner: AuthenticatedViewer,
  name: string,
): Promise<OrganizationSummary> {
  const timestampMs = currentTimestampMs();
  const organizationId: OrganizationId = createPlatformId();
  const defaultProjectId: ProjectId = createPlatformId();

  await writeOrganizationWithOwner(database, {
    name,
    defaultProjectId,
    organizationId,
    ownerId: owner.id,
    timestampMs,
  });

  await createProjectEnvironmentDefaults(
    { DB: database },
    {
      actorId: owner.id,
      projectId: defaultProjectId,
      timestampMs,
    },
  );

  return toOrganizationSummary({
    created_at: timestampMs,
    id: organizationId,
    name,
  });
}
