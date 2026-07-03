export const APP_DEPLOYMENT_RUN_DISPATCH_MAX_ATTEMPTS = 3;

export const APP_DEPLOYMENT_RUN_DISPATCH_RETRY_EXHAUSTED_CODE =
  "deployment_dispatch_retry_exhausted";

export function createAppDeploymentDispatchRetryExhaustedMessage(input: {
  attemptCount: number;
  lastErrorMessage: string | null;
}): string {
  const detail = input.lastErrorMessage?.trim();

  if (detail !== undefined && detail.length > 0) {
    return `Deployment dispatch failed after ${input.attemptCount} attempts: ${detail}`;
  }

  return `Deployment dispatch failed after ${input.attemptCount} attempts.`;
}
