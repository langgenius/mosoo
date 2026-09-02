import type { ProjectSummary } from "@mosoo/contracts/project";
import { projectsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ProjectId, OrganizationId } from "@mosoo/id";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../platform/analytics/product-analytics";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createProjectEnvironmentDefaults } from "../../environments/application/environment.service";
import { ensureOrganizationOwnership } from "../../organizations/domain/organization-ownership.policy";
import { normalizeProjectName } from "./project-defaults";
import { getProjectRow, toProjectSummary } from "./project.service";

interface CreateProjectInput {
  name: string;
  organizationId: OrganizationId;
}

// Creates an additional Project inside an organization the viewer owns. Mirrors the
// onboarding default-Project provisioning (insert Project row + default Environment).
// Kept out of project.service to avoid a projects <-> environments cycle.
export async function createProject(
  bindings: Pick<
    ApiBindings,
    | "DB"
    | "MOSOO_DEPLOYMENT_MODE"
    | "MOSOO_ENVIRONMENT"
    | "POSTHOG_API_HOST"
    | "POSTHOG_PROJECT_KEY"
  >,
  viewer: AuthenticatedViewer,
  input: CreateProjectInput,
): Promise<ProjectSummary> {
  const database = bindings.DB;
  await ensureOrganizationOwnership(database, viewer.id, input.organizationId);

  const name = normalizeProjectName(input.name);

  if (name.length > 200) {
    throw validationError("Project name is too long.");
  }

  const projectId: ProjectId = createPlatformId();
  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .insert(projectsTable)
    .values({
      createdAt: timestampMs,
      id: projectId,
      name,
      organizationId: input.organizationId,
      ownerAccountId: viewer.id,
      updatedAt: timestampMs,
    })
    .run();

  await createProjectEnvironmentDefaults(
    { DB: database },
    { actorId: viewer.id, projectId, timestampMs },
  );
  await captureServerProductEvent(bindings, {
    distinctId: viewer.id,
    event: SERVER_PRODUCT_ANALYTICS_EVENTS.projectCreated,
    properties: {
      project_id: projectId,
      organization_id: input.organizationId,
      source: "manual",
    },
  });

  return toProjectSummary(await getProjectRow(database, projectId));
}
