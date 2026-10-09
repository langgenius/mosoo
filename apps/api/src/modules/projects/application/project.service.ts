import type { ProjectSummary, RenameProjectInput } from "@mosoo/contracts/project";
import type { ProjectRow } from "@mosoo/db";
import { projectsTable } from "@mosoo/db";
import type { AccountId, OrganizationId, ProjectId } from "@mosoo/id";
import { and, asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError, notFoundError } from "../../../platform/errors";
import { requireName } from "../../../shared/require-name";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureOrganizationOwnership } from "../../organizations/domain/organization-ownership.policy";

export function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    createdAt: toIsoString(row.createdAt),
    defaultEnvironmentId: row.defaultEnvironmentId,
    id: row.id,
    name: row.name,
    ownerAccountId: row.ownerAccountId,
  };
}

export async function getProjectRow(
  database: D1Database,
  projectId: ProjectId,
): Promise<ProjectRow> {
  const row =
    (await getAppDatabase(database)
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw notFoundError("Project not found.");
  }

  return row;
}

export async function ensureProjectOwnership(
  database: D1Database,
  viewerId: AccountId,
  projectId: ProjectId,
): Promise<ProjectRow> {
  const project = await getProjectRow(database, projectId);

  if (project.ownerAccountId !== viewerId) {
    throw forbiddenError();
  }

  return project;
}

export async function renameProject(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RenameProjectInput,
): Promise<ProjectSummary> {
  await ensureProjectOwnership(database, viewer.id, input.projectId);

  const name = requireName(input.name, "Project name");

  await getAppDatabase(database)
    .update(projectsTable)
    .set({ name, updatedAt: currentTimestampMs() })
    .where(eq(projectsTable.id, input.projectId))
    .run();

  return toProjectSummary(await getProjectRow(database, input.projectId));
}

export async function listOrganizationProjects(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<ProjectSummary[]> {
  await ensureOrganizationOwnership(database, viewer.id, organizationId);

  const rows = await getAppDatabase(database)
    .select()
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.organizationId, organizationId),
        eq(projectsTable.ownerAccountId, viewer.id),
      ),
    )
    .orderBy(asc(projectsTable.id))
    .all();

  return rows.map(toProjectSummary);
}
