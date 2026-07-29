import type { ApiBindings } from "../../platform/cloudflare/worker-types";

export const WORKER_VERSION_HEADER = "X-Mosoo-Worker-Version";

export function exposeWorkerVersion(response: Response, bindings: ApiBindings): Response {
  const workerVersionId = bindings.CF_VERSION_METADATA?.id.trim();

  if (workerVersionId) {
    response.headers.set(WORKER_VERSION_HEADER, workerVersionId);
  }

  return response;
}
