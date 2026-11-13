/** Use the deployed Worker revision; local callers have no deployed version. */
export function getWorkerUserAgent(metadata?: Pick<WorkerVersionMetadata, "id">): string {
  return `mosoo/${metadata?.id || "dev"}`;
}
