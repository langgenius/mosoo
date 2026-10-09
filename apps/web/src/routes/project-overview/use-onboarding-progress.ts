import type { ProjectId } from "@mosoo/id";
import { useQuery } from "@tanstack/react-query";

import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import {
  listPersonalAccessTokens,
  personalAccessTokenKeys,
} from "@/domains/auth/api/personal-access-token-client";
import { threadSessions } from "@/domains/session/api/list";
import { useVendorCredentialsQuery } from "@/domains/vendor-credential/model/provider-credential-query";
import { threadKeys } from "@/routes/threads/model/query-keys";

export interface OnboardingProgress {
  /** At least one provider credential exists on the active Project. */
  hasProviderKey: boolean;
  /** At least one active API key exists in the selected Project. */
  hasApiToken: boolean;
  /** At least one agent is visible on the active Project. */
  hasAgent: boolean;
  /** At least one UI Thread has started a Run on the active Project. */
  hasRunThread: boolean;
}

/**
 * Completion state for the Overview onboarding checklist. It reads the same
 * queries as the Providers, API keys, Agents and Threads pages. A flag stays
 * false while its read is loading or failed, so the checklist shows plain step
 * numbers; a read error never surfaces as a page banner.
 */
export function useOnboardingProgress(projectId: ProjectId): OnboardingProgress {
  const { credentials } = useVendorCredentialsQuery(projectId);
  const tokensQuery = useQuery({
    queryFn: async () => listPersonalAccessTokens(projectId),
    queryKey: personalAccessTokenKeys.list(projectId),
  });
  const agentsQuery = useVisibleAgentsQuery(projectId);
  const threadsQuery = useQuery({
    queryFn: async () => threadSessions(projectId, "ui"),
    queryKey: threadKeys.list(projectId),
  });

  return {
    hasAgent: (agentsQuery.data?.length ?? 0) > 0,
    hasApiToken: tokensQuery.data?.tokens.some((token) => token.revokedAt === null) ?? false,
    hasProviderKey: credentials.length > 0,
    hasRunThread: threadsQuery.data?.some((thread) => thread.session.lastRun !== null) ?? false,
  };
}
