import Cloudflare from "cloudflare";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";

export interface CloudflarePagesProjectInput {
  branch: string;
  projectName: string;
}

export interface CloudflarePagesDomainInput {
  hostname: string;
  projectName: string;
}

export interface CloudflareWorkerModuleInput {
  compatibilityDate: string;
  mainModuleName: string;
  scriptContent: string;
  scriptName: string;
}

export interface CloudflareWorkerDeploymentResult {
  deploymentId: string | null;
  versionId: string | null;
}

export interface CloudflarePagesDomainResult {
  status: string | null;
}

export type CloudflareDeploymentResourceTargetKind =
  | "cloudflare_pages"
  | "cloudflare_pages_domain"
  | "cloudflare_worker"
  | "cloudflare_worker_route";

export interface CloudflareDeploymentResourceDeleteFailure {
  error: unknown;
  resourceName: string;
  targetKind: CloudflareDeploymentResourceTargetKind;
}

export interface CloudflareDeploymentClient {
  deletePagesDomain(input: CloudflarePagesDomainInput): Promise<void>;
  deletePagesProject(input: { projectName: string }): Promise<void>;
  deleteWorkerRoute(input: { hostname: string }): Promise<void>;
  deleteWorkerScript(input: { scriptName: string }): Promise<void>;
  deployWorkerModule(input: CloudflareWorkerModuleInput): Promise<CloudflareWorkerDeploymentResult>;
  ensurePagesDomain(input: CloudflarePagesDomainInput): Promise<CloudflarePagesDomainResult>;
  ensurePagesProject(input: CloudflarePagesProjectInput): Promise<{ projectId: string | null }>;
  ensureWorkerRoute(input: { hostname: string; scriptName: string }): Promise<void>;
  getLatestPagesDeployment(input: {
    projectName: string;
  }): Promise<{ deploymentId: string | null; url: string | null }>;
}

export type CloudflareClientBindings = Pick<
  ApiBindings,
  "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN" | "CLOUDFLARE_ZONE_ID"
>;

function toStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    Reflect.get(error, "status") === status
  );
}

export function logCloudflareDeploymentResourceDeleteFailures(
  eventName: string,
  failures: readonly CloudflareDeploymentResourceDeleteFailure[],
): void {
  for (const failure of failures) {
    logError(eventName, {
      ...createErrorLogContext(failure.error),
      resourceName: failure.resourceName,
      targetKind: failure.targetKind,
    });
  }
}

export function createCloudflareDeploymentClient(
  bindings: CloudflareClientBindings,
): CloudflareDeploymentClient {
  const client = new Cloudflare({ apiToken: bindings.CLOUDFLARE_API_TOKEN });
  const accountId = bindings.CLOUDFLARE_ACCOUNT_ID;
  const zoneId = bindings.CLOUDFLARE_ZONE_ID;

  return {
    async deletePagesDomain(input) {
      try {
        await client.pages.projects.domains.delete(input.projectName, input.hostname, {
          account_id: accountId,
        });
      } catch (error) {
        if (!toStatus(error, 404)) {
          throw error;
        }
      }
    },
    async deletePagesProject(input) {
      try {
        await client.pages.projects.delete(input.projectName, { account_id: accountId });
      } catch (error) {
        if (!toStatus(error, 404)) {
          throw error;
        }
      }
    },
    async deleteWorkerRoute(input) {
      const pattern = workerRoutePattern(input.hostname);
      const route = await findWorkerRoute(client, zoneId, pattern);

      if (route?.id === undefined) {
        return;
      }

      await client.workers.routes.delete(route.id, { zone_id: zoneId });
    },
    async deleteWorkerScript(input) {
      try {
        await client.workers.scripts.delete(input.scriptName, { account_id: accountId });
      } catch (error) {
        if (!toStatus(error, 404)) {
          throw error;
        }
      }
    },
    async deployWorkerModule(input) {
      const file = new File([input.scriptContent], input.mainModuleName, {
        type: "application/javascript+module",
      });
      const version = await client.workers.scripts.versions.create(input.scriptName, {
        account_id: accountId,
        files: [file],
        metadata: {
          compatibility_date: input.compatibilityDate,
          main_module: input.mainModuleName,
        },
      });
      const versionId = version.id ?? null;

      if (versionId === null) {
        throw new Error("Cloudflare Worker version response did not include an id.");
      }

      const deployment = await client.workers.scripts.deployments.create(input.scriptName, {
        account_id: accountId,
        strategy: "percentage",
        versions: [{ percentage: 100, version_id: versionId }],
      });

      return {
        deploymentId: deployment.id ?? null,
        versionId,
      };
    },
    async ensurePagesDomain(input) {
      try {
        const domain = await client.pages.projects.domains.create(input.projectName, {
          account_id: accountId,
          name: input.hostname,
        });

        return { status: domain.status ?? null };
      } catch (error) {
        if (!toStatus(error, 409)) {
          throw error;
        }

        const domain = await client.pages.projects.domains.get(input.projectName, input.hostname, {
          account_id: accountId,
        });

        return { status: domain.status ?? null };
      }
    },
    async ensurePagesProject(input) {
      try {
        const project = await client.pages.projects.create({
          account_id: accountId,
          name: input.projectName,
          production_branch: input.branch,
        });

        return { projectId: project.id ?? null };
      } catch (error) {
        if (!toStatus(error, 409)) {
          throw error;
        }

        const project = await client.pages.projects.get(input.projectName, {
          account_id: accountId,
        });

        return { projectId: project.id ?? null };
      }
    },
    async ensureWorkerRoute(input) {
      const pattern = workerRoutePattern(input.hostname);
      const existingRoute = await findWorkerRoute(client, zoneId, pattern);

      if (existingRoute !== null) {
        if (existingRoute.script !== input.scriptName && existingRoute.id !== undefined) {
          await client.workers.routes.update(existingRoute.id, {
            pattern,
            script: input.scriptName,
            zone_id: zoneId,
          });
        }

        return;
      }

      await client.workers.routes.create({
        pattern,
        script: input.scriptName,
        zone_id: zoneId,
      });
    },
    async getLatestPagesDeployment(input) {
      const deployments = client.pages.projects.deployments.list(input.projectName, {
        account_id: accountId,
        per_page: 1,
      });

      for await (const deployment of deployments) {
        return { deploymentId: deployment.id ?? null, url: deployment.url ?? null };
      }

      return { deploymentId: null, url: null };
    },
  };
}

export async function deleteCloudflareDeploymentResources(
  cloudflareClient: CloudflareDeploymentClient,
  input: { hostname: string; resourceName: string },
): Promise<CloudflareDeploymentResourceDeleteFailure[]> {
  const failures = await Promise.all([
    deleteCloudflareDeploymentResource("cloudflare_pages_domain", input.resourceName, () =>
      cloudflareClient.deletePagesDomain({
        hostname: input.hostname,
        projectName: input.resourceName,
      }),
    ),
    deleteCloudflareDeploymentResource("cloudflare_pages", input.resourceName, () =>
      cloudflareClient.deletePagesProject({ projectName: input.resourceName }),
    ),
    deleteCloudflareDeploymentResource("cloudflare_worker_route", input.resourceName, () =>
      cloudflareClient.deleteWorkerRoute({ hostname: input.hostname }),
    ),
    deleteCloudflareDeploymentResource("cloudflare_worker", input.resourceName, () =>
      cloudflareClient.deleteWorkerScript({ scriptName: input.resourceName }),
    ),
  ]);

  return failures.filter(
    (failure): failure is CloudflareDeploymentResourceDeleteFailure => failure !== null,
  );
}

async function deleteCloudflareDeploymentResource(
  targetKind: CloudflareDeploymentResourceTargetKind,
  resourceName: string,
  runDelete: () => Promise<void>,
): Promise<CloudflareDeploymentResourceDeleteFailure | null> {
  try {
    await runDelete();
    return null;
  } catch (error) {
    return { error, resourceName, targetKind };
  }
}

function workerRoutePattern(hostname: string): string {
  return `${hostname}/*`;
}

async function findWorkerRoute(
  client: Cloudflare,
  zoneId: string,
  pattern: string,
): Promise<{ id?: string; script?: string } | null> {
  const routes = client.workers.routes.list({ zone_id: zoneId });

  for await (const route of routes) {
    if (route.pattern === pattern) {
      return route;
    }
  }

  return null;
}
