import type { AppVibeApp, AppVibeAppCloneUrl } from "@mosoo/contracts/app";
import type { AppId } from "@mosoo/contracts/id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import { toAppId } from "@/routes/typed-id";

import {
  createAppVibeApp,
  createAppVibeAppCloneUrl,
  deleteAppVibeApp,
  getAppVibeApp,
  getAppVibeAppEnabled,
  publishAppVibeApp,
  refreshAppVibeAppPreview,
  sendAppVibeAppPrompt,
} from "../api/vibe-app-client";

const vibeAppKeys = {
  all: ["vibe-app"] as const,
  detail: (appId: string) => [...vibeAppKeys.all, appId] as const,
  enabled: () => [...vibeAppKeys.all, "enabled"] as const,
};

const POLL_INTERVAL_MS = 2_500;

/** Whether this deployment has a VibeSDK backend configured. */
export function useAppVibeAppEnabledQuery(): UseQueryResult<boolean> {
  return useQuery<boolean>({
    queryFn: getAppVibeAppEnabled,
    queryKey: vibeAppKeys.enabled(),
    staleTime: Infinity,
  });
}

/**
 * Live vibe app state. Polls while the builder is generating, and also until
 * `activityDeadlineMs` after a command mutation — publish and preview refresh
 * finish on the VibeSDK side without flipping `status`, so the deadline is
 * the only signal that their outcome (URL/timestamp changes) is still worth
 * watching.
 */
export function useAppVibeAppQuery(
  appId: string,
  activityDeadlineMs = 0,
): UseQueryResult<AppVibeApp | null> {
  return useQuery<AppVibeApp | null>({
    queryFn: async () => getAppVibeApp(toAppId(appId)),
    queryKey: vibeAppKeys.detail(appId),
    refetchInterval: (query) =>
      query.state.data?.status === "generating" || Date.now() < activityDeadlineMs
        ? POLL_INTERVAL_MS
        : false,
  });
}

function useVibeAppInvalidation(appId: string) {
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: vibeAppKeys.detail(appId) });
  };
}

function useVibeAppCommandMutation(
  appId: string,
  run: (appId: AppId) => Promise<void>,
): UseMutationResult<void, Error, void> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async () => run(toAppId(appId)),
    onSuccess: invalidate,
  });
}

export function useCreateAppVibeAppMutation(
  appId: string,
): UseMutationResult<AppVibeApp, Error, string> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async (prompt: string) => createAppVibeApp(toAppId(appId), prompt),
    // Settled, not just success: a "vibe app exists" conflict means another
    // create won and the console should show that app, not a stale empty form.
    onSettled: invalidate,
  });
}

export function useSendAppVibeAppPromptMutation(
  appId: string,
): UseMutationResult<void, Error, string> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async (prompt: string) => sendAppVibeAppPrompt(toAppId(appId), prompt),
    onSuccess: invalidate,
  });
}

export function usePublishAppVibeAppMutation(appId: string): UseMutationResult<void, Error, void> {
  return useVibeAppCommandMutation(appId, publishAppVibeApp);
}

export function useRefreshAppVibeAppPreviewMutation(
  appId: string,
): UseMutationResult<void, Error, void> {
  return useVibeAppCommandMutation(appId, refreshAppVibeAppPreview);
}

export function useDeleteAppVibeAppMutation(appId: string): UseMutationResult<void, Error, void> {
  return useVibeAppCommandMutation(appId, deleteAppVibeApp);
}

export function useCreateAppVibeAppCloneUrlMutation(
  appId: string,
): UseMutationResult<AppVibeAppCloneUrl, Error, void> {
  return useMutation({
    mutationFn: async () => createAppVibeAppCloneUrl(toAppId(appId)),
  });
}
