import type { SessionType } from "@mosoo/contracts/session";
import { useQuery } from "@tanstack/react-query";

import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { listPersonalAccessTokens } from "@/domains/auth/api/personal-access-token-client";
import { threadSessions } from "@/domains/session/api/list";
import { listVendorCredentials } from "@/domains/vendor-credential/api/vendor-credential-client";
import { toProjectId } from "@/routes/typed-id";

export interface OnboardingProgress {
  /** At least one provider credential exists on the active Project. */
  hasProviderKey: boolean | null;
  /** At least one non-revoked personal access token exists. */
  hasApiToken: boolean | null;
  /** At least one agent is visible on the active Project. */
  hasAgent: boolean | null;
  /** At least one UI Thread has started a Run on the active Project. */
  hasRunThread: boolean | null;
}

interface OnboardingThreadState {
  session: {
    lastRun: object | null;
    type: SessionType;
  };
}

export function hasRunUiThread(threads: readonly OnboardingThreadState[]): boolean {
  return threads.some(({ session }) => session.type === "ui" && session.lastRun !== null);
}

const onboardingKeys = {
  providerKeys: (projectId: string | null) =>
    ["onboarding-progress", "provider-keys", projectId ?? "missing"] as const,
  sessions: (projectId: string | null) =>
    ["onboarding-progress", "sessions", projectId ?? "missing"] as const,
  tokens: ["onboarding-progress", "access-tokens"] as const,
};

/**
 * Completion state for the Overview onboarding checklist. Each flag is `null`
 * while unknown (loading or failed) so the checklist renders plain step
 * numbers instead of wrong checkmarks; a read error here must never surface
 * as a page banner, the steps stay clickable either way.
 */
export function useOnboardingProgress(projectId: string | null): OnboardingProgress {
  const providerKeysQuery = useQuery({
    enabled: projectId !== null,
    queryFn: async () => {
      if (projectId === null) {
        throw new Error("Project id is required to list provider credentials.");
      }

      return listVendorCredentials(toProjectId(projectId));
    },
    queryKey: onboardingKeys.providerKeys(projectId),
    retry: 1,
  });
  const tokensQuery = useQuery({
    queryFn: listPersonalAccessTokens,
    queryKey: onboardingKeys.tokens,
    retry: 1,
  });
  const agentsQuery = useVisibleAgentsQuery(projectId);
  const sessionsQuery = useQuery({
    enabled: projectId !== null,
    queryFn: async () => {
      if (projectId === null) {
        throw new Error("Project id is required to list Thread sessions.");
      }

      return threadSessions(toProjectId(projectId), "ui");
    },
    queryKey: onboardingKeys.sessions(projectId),
    retry: 1,
  });

  return {
    hasAgent: agentsQuery.data === undefined ? null : agentsQuery.data.length > 0,
    hasApiToken:
      tokensQuery.data === undefined
        ? null
        : tokensQuery.data.tokens.some((token) => token.revokedAt === null),
    hasProviderKey: providerKeysQuery.data === undefined ? null : providerKeysQuery.data.length > 0,
    hasRunThread: sessionsQuery.data === undefined ? null : hasRunUiThread(sessionsQuery.data),
  };
}
