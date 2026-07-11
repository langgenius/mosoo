import type { AppVibeApp, AppVibeAppCloneUrl } from "@mosoo/contracts/app";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import { toAppId } from "@/routes/typed-id";

import {
  createAppVibeApp,
  createAppVibeAppCloneUrl,
  deleteAppVibeApp,
  getAppVibeApp,
  publishAppVibeApp,
  refreshAppVibeAppPreview,
  sendAppVibeAppPrompt,
} from "../api/vibe-app-client";

const vibeAppKeys = {
  all: ["vibe-app"] as const,
  detail: (appId: string) => [...vibeAppKeys.all, appId] as const,
};

const POLL_INTERVAL_MS = 2_500;

/**
 * Live vibe app state. Polls while the builder is generating, and also until
 * `activityDeadlineMs` after a command mutation — publish and preview refresh
 * finish on the VibeSDK side without flipping `status`, so the deadline is
 * the only signal that their outcome (URL changes) is still worth watching.
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

export function useCreateAppVibeAppMutation(
  appId: string,
): UseMutationResult<AppVibeApp, Error, string> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async (prompt: string) => createAppVibeApp(toAppId(appId), prompt),
    onSuccess: invalidate,
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
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async () => publishAppVibeApp(toAppId(appId)),
    onSuccess: invalidate,
  });
}

export function useRefreshAppVibeAppPreviewMutation(
  appId: string,
): UseMutationResult<void, Error, void> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async () => refreshAppVibeAppPreview(toAppId(appId)),
    onSuccess: invalidate,
  });
}

export function useCreateAppVibeAppCloneUrlMutation(
  appId: string,
): UseMutationResult<AppVibeAppCloneUrl, Error, void> {
  return useMutation({
    mutationFn: async () => createAppVibeAppCloneUrl(toAppId(appId)),
  });
}

export function useDeleteAppVibeAppMutation(appId: string): UseMutationResult<void, Error, void> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async () => deleteAppVibeApp(toAppId(appId)),
    onSuccess: invalidate,
  });
}
