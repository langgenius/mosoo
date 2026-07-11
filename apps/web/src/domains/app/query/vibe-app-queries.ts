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
  missing: () => [...vibeAppKeys.all, "missing"] as const,
};

const GENERATING_POLL_INTERVAL_MS = 2_500;

function requireAppId(appId: string | null): string {
  if (appId === null || appId.length === 0) {
    throw new Error("App id is required to load the vibe app.");
  }

  return appId;
}

export function useAppVibeAppQuery(appId: string | null): UseQueryResult<AppVibeApp | null> {
  return useQuery<AppVibeApp | null>({
    enabled: appId !== null,
    queryFn: async () => getAppVibeApp(toAppId(requireAppId(appId))),
    queryKey: appId !== null ? vibeAppKeys.detail(appId) : vibeAppKeys.missing(),
    refetchInterval: (query) =>
      query.state.data?.status === "generating" ? GENERATING_POLL_INTERVAL_MS : false,
  });
}

function useVibeAppInvalidation(appId: string | null) {
  const queryClient = useQueryClient();

  return async () => {
    if (appId !== null) {
      await queryClient.invalidateQueries({ queryKey: vibeAppKeys.detail(appId) });
    }
  };
}

export function useCreateAppVibeAppMutation(
  appId: string | null,
): UseMutationResult<AppVibeApp, Error, string> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async (prompt: string) => createAppVibeApp(toAppId(requireAppId(appId)), prompt),
    onSuccess: invalidate,
  });
}

export function useSendAppVibeAppPromptMutation(
  appId: string | null,
): UseMutationResult<void, Error, string> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async (prompt: string) =>
      sendAppVibeAppPrompt(toAppId(requireAppId(appId)), prompt),
    onSuccess: invalidate,
  });
}

export function usePublishAppVibeAppMutation(
  appId: string | null,
): UseMutationResult<void, Error, void> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async () => publishAppVibeApp(toAppId(requireAppId(appId))),
    onSuccess: invalidate,
  });
}

export function useRefreshAppVibeAppPreviewMutation(
  appId: string | null,
): UseMutationResult<void, Error, void> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async () => refreshAppVibeAppPreview(toAppId(requireAppId(appId))),
    onSuccess: invalidate,
  });
}

export function useCreateAppVibeAppCloneUrlMutation(
  appId: string | null,
): UseMutationResult<AppVibeAppCloneUrl, Error, void> {
  return useMutation({
    mutationFn: async () => createAppVibeAppCloneUrl(toAppId(requireAppId(appId))),
  });
}

export function useDeleteAppVibeAppMutation(
  appId: string | null,
): UseMutationResult<void, Error, void> {
  const invalidate = useVibeAppInvalidation(appId);

  return useMutation({
    mutationFn: async () => deleteAppVibeApp(toAppId(requireAppId(appId))),
    onSuccess: invalidate,
  });
}
