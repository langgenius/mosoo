import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { createAgentSession, sendAgentSessionEvents } from "@/domains/session/api/agent-session";
import {
  archiveAgentSession,
  deleteAgentSession,
  unarchiveAgentSession,
} from "@/domains/session/api/mutations";
import { updateSessionThreadUiState } from "@/domains/session/api/thread-projections";
import { uploadSessionResource } from "@/features/session-files/session-resource-upload";
import { toAgentId, toFileId, toSessionId } from "@/routes/typed-id";

import type { NewThreadSubmitInput } from "../compose/new-dialog";
import type { ThreadFollowUpInput } from "./action-types";
import { getMutationErrorMessage } from "./format";
import { threadKeys } from "./query-keys";
import type { ThreadListItem } from "./thread";

export function useThreadActions({
  activeOrganizationId,
  activeThreadId,
  allThreads,
  closeComposeDialog,
  navigateToList,
}: {
  activeOrganizationId: string | null;
  activeThreadId: string | null;
  allThreads: readonly ThreadListItem[];
  closeComposeDialog: () => void;
  navigateToList: () => void;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const threadStateMutation = useMutation({
    mutationFn: updateSessionThreadUiState,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: threadKeys.uiStates(activeOrganizationId),
      });
    },
  });
  const createMutation = useMutation({
    mutationFn: async (input: NewThreadSubmitInput) => {
      const createdSession = await createAgentSession(toAgentId(input.agentId), "ui");

      try {
        const uploadedResources = await Promise.all(
          input.files.map(async (file) => uploadSessionResource(createdSession.id, file)),
        );
        await sendAgentSessionEvents({
          events: [
            {
              attachmentIds: uploadedResources.map((resource) => toFileId(resource.id)),
              clientRequestId: crypto.randomUUID(),
              text: input.body,
              type: "user_message",
            },
          ],
          sessionId: createdSession.id,
        });
      } catch (error) {
        try {
          await deleteAgentSession(createdSession.id);
        } catch (cleanupError) {
          throw new Error(
            `${getMutationErrorMessage(error, "Failed to dispatch thread.")} Cleanup failed: ${getMutationErrorMessage(cleanupError, "created session could not be deleted.")}`,
            { cause: cleanupError },
          );
        }

        throw error;
      }

      return createdSession;
    },
    onSuccess: async (session) => {
      setActionError(null);
      closeComposeDialog();
      await threadStateMutation.mutateAsync({
        readAt: new Date().toISOString(),
        sessionId: session.id,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKeys.lists(activeOrganizationId) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.uiStates(activeOrganizationId) }),
      ]);
      navigateToList();
    },
  });
  const archiveMutation = useMutation({
    mutationFn: archiveAgentSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: threadKeys.lists(activeOrganizationId),
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAgentSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: threadKeys.lists(activeOrganizationId),
      });
    },
  });
  const followUpMutation = useMutation({
    mutationFn: async (input: ThreadFollowUpInput) => {
      if (input.thread.bucket === "archived") {
        await unarchiveAgentSession(toSessionId(input.thread.id));
      }

      await sendAgentSessionEvents({
        events: [
          {
            attachmentIds: [],
            clientRequestId: crypto.randomUUID(),
            text: input.body,
            type: "user_message",
          },
        ],
        sessionId: toSessionId(input.thread.id),
      });
    },
    onSuccess: async (_result, input) => {
      setActionError(null);
      await threadStateMutation.mutateAsync({
        readAt: new Date().toISOString(),
        sessionId: toSessionId(input.thread.id),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKeys.lists(activeOrganizationId) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.detailMessages(input.thread.id) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.processEvents(input.thread.id) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.uiStates(activeOrganizationId) }),
      ]);
    },
  });

  const createThread = useCallback(
    async (input: NewThreadSubmitInput): Promise<void> => {
      await createMutation.mutateAsync(input);
    },
    [createMutation],
  );

  const markThreadRead = useCallback(
    async (input: { readAt: string; threadId: string }): Promise<void> => {
      await threadStateMutation.mutateAsync({
        readAt: input.readAt,
        sessionId: toSessionId(input.threadId),
      });
    },
    [threadStateMutation],
  );

  const togglePinnedThread = useCallback(
    async (threadId: string): Promise<void> => {
      const thread = allThreads.find((candidate) => candidate.id === threadId) ?? null;

      if (thread === null) {
        return;
      }

      try {
        setActionError(null);
        await threadStateMutation.mutateAsync({
          pinned: !thread.pinned,
          sessionId: toSessionId(threadId),
        });
      } catch (error) {
        setActionError(getMutationErrorMessage(error, "Failed to update pinned state."));
      }
    },
    [allThreads, threadStateMutation],
  );

  const archiveThread = useCallback(
    async (threadId: string): Promise<void> => {
      try {
        setActionError(null);
        await archiveMutation.mutateAsync(toSessionId(threadId));
      } catch (error) {
        setActionError(getMutationErrorMessage(error, "Failed to archive thread."));
      }
    },
    [archiveMutation],
  );

  const deleteThread = useCallback(
    async (threadId: string): Promise<void> => {
      // PRD AC-3.8 explicitly requires window.confirm for destructive delete.
      if (!globalThis.confirm("Delete this thread?")) {
        return;
      }

      try {
        setActionError(null);
        await deleteMutation.mutateAsync(toSessionId(threadId));

        if (activeThreadId === threadId) {
          navigateToList();
        }
      } catch (error) {
        setActionError(getMutationErrorMessage(error, "Failed to delete thread."));
      }
    },
    [activeThreadId, deleteMutation, navigateToList],
  );

  const sendFollowUp = useCallback(
    async (input: ThreadFollowUpInput): Promise<void> => {
      try {
        await followUpMutation.mutateAsync(input);
      } catch (error) {
        setActionError(getMutationErrorMessage(error, "Failed to send follow-up."));
      }
    },
    [followUpMutation],
  );

  const createError = createMutation.error
    ? getMutationErrorMessage(createMutation.error, "Failed to create thread.")
    : null;

  return {
    actionError,
    archiveThread,
    createError,
    createThread,
    creatingThread: createMutation.isPending,
    deleteThread,
    markThreadRead,
    sendFollowUp,
    sendingFollowUp: followUpMutation.isPending,
    setActionError,
    togglePinnedThread,
  };
}
