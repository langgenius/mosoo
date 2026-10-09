import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { AgentReadiness } from "@mosoo/contracts/agent";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { sessionResourcesQueryKey } from "@/domains/session/api/session-resources";
import { SessionThread } from "@/features/session-chat/assistant-ui/session-thread";
import { SessionThreadComposer } from "@/features/session-chat/assistant-ui/session-thread-composer";
import { useSessionAssistantRuntime } from "@/features/session-chat/assistant-ui/use-session-assistant-runtime";
import { SessionRuntimeControls } from "@/features/session-chat/session-runtime-controls";
import { useSessionResourceDraft } from "@/features/session-chat/use-session-resource-draft";
import { uploadSessionResource } from "@/features/session-files/session-resource-upload";
import { toProjectId, toSessionId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

import { isTruthy } from "../../../shared/lib/truthiness";
import { AgentReadinessBlockersBanner } from "./agent-readiness-blockers-banner";
import { AgentSessionPanelHeader } from "./agent-session-panel-header";
import {
  deriveSessionPill,
  readinessBlockSummary,
  sendDisabledReasonForSession,
} from "./agent-session-panel-status";
import { useAgentSessionPanelModel } from "./use-agent-session-panel-model";

interface PendingSessionFile {
  id: string;
  name: string;
  status: "failed" | "uploading";
}

export function AgentSessionPanel({
  agentId,
  agentName,
  configurationChangedAt,
  projectId,
  readiness,
}: {
  agentId: string;
  agentName: string;
  configurationChangedAt: string;
  readiness: AgentReadiness | null;
  projectId: string | null;
}) {
  const { t } = useTranslation();
  const model = useAgentSessionPanelModel({
    agentId,
    configurationChangedAt,
    projectId,
    readiness,
  });
  const activeTitle = model.activeSession?.title ?? null;
  const pill = deriveSessionPill(model);
  const stopped = pill === "Stopped";
  const setupBlocked = pill === "Setup required";
  const setupSummary = readinessBlockSummary(model.readiness, t) ?? model.readinessBlockMessage;
  const reconnectingSubtitle =
    model.reconnecting || model.lifecycle === "RESCHEDULING" ? t("agent.reconnecting") : null;
  const sendDisabledReason = sendDisabledReasonForSession(
    {
      lifecycle: model.lifecycle,
      reconnecting: model.reconnecting,
      setupBlocked,
      setupSummary,
      stopped,
    },
    t,
  );

  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFilesBySession, setPendingFilesBySession] = useState<
    Record<string, PendingSessionFile[]>
  >({});
  const activeSessionId =
    model.activeSessionId === null ? null : toSessionId(model.activeSessionId);
  const resourceDraft = useSessionResourceDraft(activeSessionId);
  const pendingSessionFiles = isTruthy(activeSessionId)
    ? (pendingFilesBySession[activeSessionId] ?? [])
    : [];
  const sessionResourceMentions = resourceDraft.mentions;
  const handleResetPreviewSession = async (): Promise<void> => {
    resourceDraft.clearActiveMentions();
    await model.handleResetSession();
  };

  const updatePendingFiles = (
    sessionId: string,
    update: (files: PendingSessionFile[]) => PendingSessionFile[],
  ): void => {
    setPendingFilesBySession((current) => ({
      ...current,
      [sessionId]: update(current[sessionId] ?? []),
    }));
  };

  const handleUploadFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) {
      return;
    }

    const sessionId = toSessionId(await model.ensureActiveSession());

    const uploaded = await Promise.all(
      files.map(async (file): Promise<boolean> => {
        const pendingId = crypto.randomUUID();
        updatePendingFiles(sessionId, (current) => [
          { id: pendingId, name: file.name, status: "uploading" },
          ...current,
        ]);

        try {
          const uploadedResource = await uploadSessionResource(projectId, sessionId, file);
          updatePendingFiles(sessionId, (current) =>
            current.filter((pending) => pending.id !== pendingId),
          );
          resourceDraft.appendMention(sessionId, uploadedResource);
          await queryClient.invalidateQueries({
            queryKey: sessionResourcesQueryKey(
              projectId === null ? null : toProjectId(projectId),
              sessionId,
            ),
          });
          return true;
        } catch {
          updatePendingFiles(sessionId, (current) =>
            current.map((pending) =>
              pending.id === pendingId ? { ...pending, status: "failed" } : pending,
            ),
          );
          return false;
        }
      }),
    );

    if (uploaded.includes(false)) {
      // Like a failed send: the server rejects uploads into an expired or
      // deleted Preview, and once the list drops it the next upload or send
      // starts a new one.
      void model.refreshSessions();
    }
  };

  const lastSentTextRef = useRef("");

  const handleSendText = useCallback(
    async (text: string): Promise<void> => {
      lastSentTextRef.current = text;

      // Chips stay until the send succeeds, so "Retry send" still carries them.
      if (await model.handleSend({ sessionResourceMentions, text })) {
        resourceDraft.clearActiveMentions();
      }
    },
    [model, resourceDraft, sessionResourceMentions],
  );

  const handleRetrySend = useCallback((): void => {
    void handleSendText(lastSentTextRef.current);
  }, [handleSendText]);

  const runtime = useSessionAssistantRuntime({
    isSendDisabled: Boolean(sendDisabledReason),
    messages: model.messages,
    onCancel: model.cancel,
    onSend: handleSendText,
    streaming: model.streaming,
  });

  return (
    <div className="bg-paper-200 flex h-full" data-testid="agent-session-panel">
      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <AgentSessionPanelHeader
            activeTitle={activeTitle}
            agentName={agentName}
            onSessionControlClick={handleResetPreviewSession}
            pill={pill}
            reconnectingSubtitle={reconnectingSubtitle}
            runtimeControls={
              model.activeSession ? (
                <SessionRuntimeControls
                  key={model.activeSession.id}
                  session={model.activeSession}
                />
              ) : null
            }
            sending={model.sending}
          />

          <p className="text-fg-3 border-b px-4 py-2 text-xs leading-relaxed">
            {t("agent.previewRetention")}
          </p>

          {isTruthy(model.sessionLoadError) ? (
            <div className="border-warning/30 bg-warning-bg text-warning-fg border-b px-4 py-2.5 text-[12px] leading-relaxed">
              {t("agent.failedToLoadPreviewChat")}
            </div>
          ) : null}

          {model.configurationRefreshRequired ? (
            <div className="border-warning/30 bg-warning-bg border-b px-4 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-warning-fg min-w-0 text-[12px] font-medium">
                  {t("agent.sessionPresetChanged")}
                </div>
                <Button
                  onClick={() => void handleResetPreviewSession()}
                  size="xs"
                  variant="outline"
                >
                  {t("agent.resetChat")}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {model.isConversationLoading ? (
              <div className="text-fg-3 flex h-full items-center justify-center text-[13px]">
                {t("agent.loadingConversation")}
              </div>
            ) : (
              <SessionThread />
            )}
          </div>

          <div className="relative z-10 mx-auto w-2/3 shrink-0 py-4">
            {stopped ? (
              <div
                className="border-danger/25 bg-danger/[0.05] mb-3 rounded-lg border px-3 py-2.5"
                role="alert"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-danger text-[13px] font-semibold">
                      {t("agent.sessionStopped")}
                    </div>
                    <div className="text-fg-2 mt-0.5 text-[12px] leading-relaxed">
                      {model.run.error?.message ?? t("agent.startNewAfterRuntimeDiagnostics")}
                    </div>
                  </div>
                  <Button
                    onClick={() => void handleResetPreviewSession()}
                    size="sm"
                    variant="outline"
                  >
                    {t("agent.resetChat")}
                  </Button>
                </div>
              </div>
            ) : null}

            {setupBlocked && model.readiness ? (
              <AgentReadinessBlockersBanner readiness={model.readiness} summary={setupSummary} />
            ) : null}

            <SessionThreadComposer
              composerError={model.composerError}
              fileInputRef={fileInputRef}
              onFilesSelected={(files) => void handleUploadFiles(files)}
              onRetry={handleRetrySend}
              onTypingActivity={model.notifyComposerTyping}
              pendingSessionFiles={pendingSessionFiles}
              sendDisabledReason={sendDisabledReason}
              sessionResourceMentions={sessionResourceMentions}
              showSendDisabledReason={!setupBlocked}
            />
          </div>
        </div>
      </AssistantRuntimeProvider>
    </div>
  );
}
