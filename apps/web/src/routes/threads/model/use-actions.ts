import type { ProjectId, SessionId } from "@mosoo/contracts/id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { createAgentSession, sendAgentSessionEvents } from "@/domains/session/api/agent-session";
import {
  archiveAgentSession,
  deleteAgentSession,
  unarchiveAgentSession,
} from "@/domains/session/api/mutations";
import { uploadSessionResource } from "@/features/session-files/session-resource-upload";
import { toAgentId, toFileId, toProjectId, toSessionId } from "@/routes/typed-id";

import type { NewThreadSubmitInput } from "../compose/new-dialog";
import type { ThreadFollowUpInput } from "./action-types";
import { getMutationErrorMessage } from "./format";
import { threadKeys } from "./query-keys";
import type { ThreadListItem } from "./thread";

export function useThreadActions({
  activeProjectId,
  activeThreadId,
  closeComposeDialog,
  markThreadReadLocal,
  navigateToList,
  threadsById,
  togglePinnedThreadLocal,
}: {
  activeProjectId: string | null;
  activeThreadId: string | null;
  closeComposeDialog: () => void;
  markThreadReadLocal: (input: { readAt: string; threadId: string }) => void;
  navigateToList: () => void;
  threadsById: ReadonlyMap<string, ThreadListItem>;
  togglePinnedThreadLocal: (threadId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: async (input: NewThreadSubmitInput) => {
      if (activeProjectId === null) {
        throw new Error("Project id is required to create threads.");
      }

      const projectId = toProjectId(activeProjectId);
      const createdSession = await createAgentSession(projectId, toAgentId(input.agentId), "ui");

      try {
        const uploadedResources = await Promise.all(
          input.files.map(async (file) =>
            uploadSessionResource(activeProjectId, createdSession.id, file),
          ),
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
          projectId,
          sessionId: createdSession.id,
        });
      } catch (error) {
        try {
          await deleteAgentSession(projectId, createdSession.id);
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
      markThreadReadLocal({
        readAt: new Date().toISOString(),
        threadId: session.id,
      });
      await queryClient.invalidateQueries({ queryKey: threadKeys.lists(activeProjectId) });
      navigateToList();
    },
  });
  const archiveMutation = useMutation({
    mutationFn: async (input: { projectId: ProjectId; sessionId: SessionId }) =>
      archiveAgentSession(input.projectId, input.sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: threadKeys.lists(activeProjectId),
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async (input: { projectId: ProjectId; sessionId: SessionId }) =>
      deleteAgentSession(input.projectId, input.sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: threadKeys.lists(activeProjectId),
      });
    },
  });
  const followUpMutation = useMutation({
    mutationFn: async (input: ThreadFollowUpInput) => {
      if (input.thread.bucket === "archived") {
        await unarchiveAgentSession(input.thread.session.projectId, toSessionId(input.thread.id));
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
        projectId: input.thread.session.projectId,
        sessionId: toSessionId(input.thread.id),
      });
    },
    onSuccess: async (_result, input) => {
      setActionError(null);
      markThreadReadLocal({
        readAt: new Date().toISOString(),
        threadId: input.thread.id,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: threadKeys.lists(activeProjectId) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.detailMessages(input.thread.id) }),
        queryClient.invalidateQueries({ queryKey: threadKeys.processEvents(input.thread.id) }),
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
      markThreadReadLocal(input);
    },
    [markThreadReadLocal],
  );

  const togglePinnedThread = useCallback(
    async (threadId: string): Promise<void> => {
      const thread = threadsById.get(threadId) ?? null;

      if (thread === null) {
        return;
      }

      try {
        setActionError(null);
        togglePinnedThreadLocal(threadId);
      } catch (error) {
        setActionError(getMutationErrorMessage(error, "Failed to update pinned state."));
      }
    },
    [threadsById, togglePinnedThreadLocal],
  );

  const archiveThread = useCallback(
    async (threadId: string): Promise<void> => {
      const thread = threadsById.get(threadId) ?? null;

      try {
        if (thread === null) {
          throw new Error("Thread not found.");
        }

        setActionError(null);
        await archiveMutation.mutateAsync({
          projectId: thread.session.projectId,
          sessionId: toSessionId(threadId),
        });
      } catch (error) {
        setActionError(getMutationErrorMessage(error, "Failed to archive thread."));
      }
    },
    [threadsById, archiveMutation],
  );

  const deleteThread = useCallback(
    async (threadId: string): Promise<void> => {
      // PRD AC-3.8 explicitly requires window.confirm for destructive delete.
      if (!globalThis.confirm("Delete this thread?")) {
        return;
      }

      try {
        const thread = threadsById.get(threadId) ?? null;

        if (thread === null) {
          throw new Error("Thread not found.");
        }

        setActionError(null);
        await deleteMutation.mutateAsync({
          projectId: thread.session.projectId,
          sessionId: toSessionId(threadId),
        });

        if (activeThreadId === threadId) {
          navigateToList();
        }
      } catch (error) {
        setActionError(getMutationErrorMessage(error, "Failed to delete thread."));
      }
    },
    [activeThreadId, threadsById, deleteMutation, navigateToList],
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
