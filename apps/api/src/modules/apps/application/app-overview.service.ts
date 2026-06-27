import type {
  AppOverview,
  AppOverviewAgent,
  AppOverviewProviderCredential,
  ControlPlaneOverview,
} from "@mosoo/contracts/app";
import type { AppId } from "@mosoo/id";

import { validationError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import { listAppOwnerAgentRowsPage } from "../../agents/application/agent-repository";
import { toAgentRuntimeModelProjection } from "../../agents/application/agent-runtime-model-identity";
import type { AgentRow } from "../../agents/application/agent-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { resolveActiveOrganization } from "../../users/application/account-organization-context.service";
import { parseCredentialModels } from "../../vendor-credentials/application/vendor-credential.mapper";
import {
  listAppVendorCredentialCountsByVendor,
  listAppVendorCredentialRowsPage,
} from "../../vendor-credentials/application/vendor-credential.repository";
import type { VendorCredentialRow } from "../../vendor-credentials/application/vendor-credential.types";
import type { AppDeploymentReadBindings } from "./app-deployment.service";
import { readAppDeploymentForOwnedApp } from "./app-deployment.service";
import { ensureAppOwnership, listOrganizationAppsPage, toAppSummary } from "./app.service";

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

function toOverviewAgent(row: AgentRow): AppOverviewAgent {
  const runtimeModel = toAgentRuntimeModelProjection(row);

  return {
    appId: row.appId,
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

function toOverviewProviderCredential(row: VendorCredentialRow): AppOverviewProviderCredential {
  return {
    appId: row.appId,
    hasCustomApiBase: row.apiBase !== null,
    id: row.id,
    isDefault: row.isDefault,
    modelCount: parseCredentialModels(row.modelsJson)?.length ?? 0,
    name: row.name,
    status: "configured",
    vendorId: row.vendorId,
  };
}

export async function getAppOverview(
  bindings: AppDeploymentReadBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentLimit?: number | null;
    appId: AppId;
    credentialLimit?: number | null;
  },
): Promise<AppOverview> {
  const agentLimit = normalizeOverviewLimit(input.agentLimit, "agentLimit");
  const credentialLimit = normalizeOverviewLimit(input.credentialLimit, "credentialLimit");
  const app = await ensureAppOwnership(bindings.DB, viewer.id, input.appId);

  const [agentRows, credentialRows, credentialCounts, deployment] = await Promise.all([
    listAppOwnerAgentRowsPage(bindings.DB, {
      appId: input.appId,
      limit: agentLimit + 1,
      viewerId: viewer.id,
    }),
    listAppVendorCredentialRowsPage(bindings.DB, input.appId, credentialLimit + 1),
    listAppVendorCredentialCountsByVendor(bindings.DB, input.appId),
    readAppDeploymentForOwnedApp(bindings, input.appId),
  ]);

  return {
    agents: {
      hasMore: agentRows.length > agentLimit,
      items: agentRows.slice(0, agentLimit).map(toOverviewAgent),
      limit: agentLimit,
    },
    app: toAppSummary(app),
    deployment,
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
  bindings: AppDeploymentReadBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentLimit?: number | null;
    appLimit?: number | null;
    credentialLimit?: number | null;
  } = {},
): Promise<ControlPlaneOverview> {
  const appLimit = normalizeOverviewLimit(input.appLimit, "appLimit");
  const activeOrganization = await resolveActiveOrganization(bindings.DB, viewer.id);

  if (activeOrganization === null) {
    return {
      activeOrganization,
      apps: {
        hasMore: false,
        items: [],
        limit: appLimit,
      },
    };
  }

  const apps = await listOrganizationAppsPage(bindings.DB, viewer, {
    limit: appLimit + 1,
    organizationId: activeOrganization.id,
  });

  return {
    activeOrganization,
    apps: {
      hasMore: apps.length > appLimit,
      items: await Promise.all(
        apps.slice(0, appLimit).map((app) =>
          getAppOverview(bindings, viewer, {
            ...(input.agentLimit === undefined ? {} : { agentLimit: input.agentLimit }),
            appId: app.id,
            ...(input.credentialLimit === undefined
              ? {}
              : { credentialLimit: input.credentialLimit }),
          }),
        ),
      ),
      limit: appLimit,
    },
  };
}
