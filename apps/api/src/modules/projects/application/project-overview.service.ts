import type {
  ProjectOverview,
  ProjectOverviewAgent,
  ProjectOverviewProviderCredential,
  ControlPlaneOverview,
} from "@mosoo/contracts/project";
import type { ProjectId } from "@mosoo/id";

import { validationError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import { listProjectOwnerAgentRowsPage } from "../../agents/application/agent-repository";
import { toAgentRuntimeModelProjection } from "../../agents/application/agent-runtime-model-identity";
import type { AgentRow } from "../../agents/application/agent-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { resolveActiveOrganization } from "../../users/application/account-organization-context.service";
import { parseCredentialModels } from "../../vendor-credentials/application/vendor-credential.mapper";
import {
  listProjectVendorCredentialCountsByVendor,
  listProjectVendorCredentialRowsPage,
} from "../../vendor-credentials/application/vendor-credential.repository";
import type { VendorCredentialRow } from "../../vendor-credentials/application/vendor-credential.types";
import {
  ensureProjectOwnership,
  listOrganizationProjectsPage,
  toProjectSummary,
} from "./project.service";

const DEFAULT_OVERVIEW_LIMIT = 50;
const MAX_OVERVIEW_LIMIT = 100;

function normalizeOverviewLimit(value: number | null | undefined, field: string): number {
  if (value === null || value === undefined) {
    return DEFAULT_OVERVIEW_LIMIT;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw validationError(`${field} must be a positive integer.`);
  }

  return Math.min(value, MAX_OVERVIEW_LIMIT);
}

function toOverviewAgent(row: AgentRow): ProjectOverviewAgent {
  const runtimeModel = toAgentRuntimeModelProjection(row);

  return {
    projectId: row.projectId,
    description: row.description,
    id: row.id,
    kind: row.kind,
    model: runtimeModel.model,
    name: row.name,
    provider: runtimeModel.provider,
    runtimeId: runtimeModel.runtimeId,
    status: row.status,
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toOverviewProviderCredential(row: VendorCredentialRow): ProjectOverviewProviderCredential {
  return {
    projectId: row.projectId,
    hasCustomApiBase: row.apiBase !== null,
    id: row.id,
    isDefault: row.isDefault,
    modelCount: parseCredentialModels(row.modelsJson)?.length ?? 0,
    name: row.name,
    status: "configured",
    vendorId: row.vendorId,
  };
}

export async function getProjectOverview(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentLimit?: number | null;
    projectId: ProjectId;
    credentialLimit?: number | null;
  },
): Promise<ProjectOverview> {
  const agentLimit = normalizeOverviewLimit(input.agentLimit, "agentLimit");
  const credentialLimit = normalizeOverviewLimit(input.credentialLimit, "credentialLimit");
  const project = await ensureProjectOwnership(database, viewer.id, input.projectId);

  const [agentRows, credentialRows, credentialCounts] = await Promise.all([
    listProjectOwnerAgentRowsPage(database, {
      projectId: input.projectId,
      limit: agentLimit + 1,
      viewerId: viewer.id,
    }),
    listProjectVendorCredentialRowsPage(database, input.projectId, credentialLimit + 1),
    listProjectVendorCredentialCountsByVendor(database, input.projectId),
  ]);

  return {
    agents: {
      hasMore: agentRows.length > agentLimit,
      items: agentRows.slice(0, agentLimit).map(toOverviewAgent),
      limit: agentLimit,
    },
    project: toProjectSummary(project),
    providerCredentials: {
      byVendor: credentialCounts,
      configuredCount: credentialCounts.reduce((sum, row) => sum + row.count, 0),
      hasMore: credentialRows.length > credentialLimit,
      items: credentialRows.slice(0, credentialLimit).map(toOverviewProviderCredential),
      limit: credentialLimit,
    },
  };
}

export async function getControlPlaneOverview(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentLimit?: number | null;
    projectLimit?: number | null;
    credentialLimit?: number | null;
  } = {},
): Promise<ControlPlaneOverview> {
  const projectLimit = normalizeOverviewLimit(input.projectLimit, "projectLimit");
  const activeOrganization = await resolveActiveOrganization(database, viewer.id);

  if (activeOrganization === null) {
    return {
      activeOrganization,
      projects: {
        hasMore: false,
        items: [],
        limit: projectLimit,
      },
    };
  }

  const projects = await listOrganizationProjectsPage(database, viewer, {
    limit: projectLimit + 1,
    organizationId: activeOrganization.id,
  });

  return {
    activeOrganization,
    projects: {
      hasMore: projects.length > projectLimit,
      items: await Promise.all(
        projects.slice(0, projectLimit).map((project) =>
          getProjectOverview(database, viewer, {
            ...(input.agentLimit === undefined ? {} : { agentLimit: input.agentLimit }),
            projectId: project.id,
            ...(input.credentialLimit === undefined
              ? {}
              : { credentialLimit: input.credentialLimit }),
          }),
        ),
      ),
      limit: projectLimit,
    },
  };
}
