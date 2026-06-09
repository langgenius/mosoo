import type { AgentReadiness } from "@mosoo/contracts/agent";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, X } from "lucide-react";
import type React from "react";

import { sessionResourcesQueryKey } from "@/domains/session/api/session-resources";
import { SessionComposer } from "@/features/session-chat/session-composer";
import { SessionMessageList } from "@/features/session-chat/session-message-list";
import { useSessionResourceDraft } from "@/features/session-chat/use-session-resource-draft";
import {
  completeSessionFileUpload,
  failSessionFileUpload,
  markSessionFileUploadProgress,
  startSessionFileUpload,
  useSessionFilesStore,
} from "@/features/session-files/session-files-store";
import { uploadSessionResource } from "@/features/session-files/session-resource-upload";
import { toSessionId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";

import { isTruthy } from "../../../shared/lib/truthiness";
import { AgentReadinessBlockersBanner } from "./agent-readiness-blockers-banner";
import { AgentSessionPanelHeader } from "./agent-session-panel-header";
import { getSessionControlMode, shouldBlockSessionFileUpload } from "./agent-session-panel-rules";
import {
  deriveSessionPill,
  readinessBlockSummary,
  sendDisabledReasonForSession,
} from "./agent-session-panel-status";
import { useAgentSessionPanelModel } from "./use-agent-session-panel-model";

export function AgentSessionPanel({
  agentId,
  agentName,
  configurationChangedAt,
  configurationRevisionKey,
  tone,
  organizationId,
  readiness,
}: {
  agentId: string;
  agentName: string;
  configurationChangedAt?: string | null;
  configurationRevisionKey?: string | null;
  readiness: AgentReadiness | null;
  tone: "preview" | "consume";
  organizationId: string | null;
}) {
  const model = useAgentSessionPanelModel({
    agentId,
    configurationChangedAt: configurationChangedAt ?? null,
    configurationRevisionKey: configurationRevisionKey ?? null,
    organizationId,
    readiness,
    requireFreshConfiguration: tone === "preview",
    sessionType: tone === "preview" ? "preview" : "ui",
    waitForRuntimeReadyOnNewSession: tone === "preview",
  });
  const activeTitle = model.activeSession?.title ?? null;
  const pill = deriveSessionPill(model);
  const sessionControlMode = getSessionControlMode(tone);
  const previewResetMode = sessionControlMode === "reset";
  const stopped = pill === "Stopped";
  const setupBlocked = pill === "Setup required";
  const setupSummary = readinessBlockSummary(model.readiness) ?? model.readinessBlockMessage;
  const reconnectingSubtitle =
    model.reconnecting || model.lifecycle === "RESCHEDULING" ? "reconnecting" : null;
  const sendDisabledReason = sendDisabledReasonForSession({
    configurationRefreshRequired: model.configurationRefreshRequired,
    lifecycle: model.lifecycle,
    reconnecting: model.reconnecting,
    setupBlocked,
    setupSummary,
    stopped,
  });

  const queryClient = useQueryClient();
  const { pendingBySession } = useSessionFilesStore();
  const activeSessionId =
    model.activeSessionId === null ? null : toSessionId(model.activeSessionId);
  const resourceDraft = useSessionResourceDraft(activeSessionId);
  const pendingFiles = isTruthy(activeSessionId) ? (pendingBySession[activeSessionId] ?? []) : [];
  const sessionResourceMentions = resourceDraft.mentions;
  const pendingSessionFiles = pendingFiles.flatMap((file) => {
    if (file.status !== "uploading" && file.status !== "failed") {
      return [];
    }

    return [
      {
        id: file.id,
        name: file.name,
        ...(typeof file.progress === "number" ? { progress: file.progress } : {}),
        status: file.status,
      },
    ];
  });
  const fileUploadDisabled = shouldBlockSessionFileUpload({
    activeSessionId: model.activeSessionId,
    tone,
  });
  const fileUploadDisabledReason = fileUploadDisabled
    ? "Send a test message before attaching files to this preview chat."
    : null;
  const sessionLoadErrorMessage = previewResetMode
    ? "Failed to load the previous preview chat. You can still send a new test message."
    : "Failed to load previous sessions. You can still start a new live run.";
  const configurationRefreshMessage = previewResetMode
    ? "Reset chat to test latest config"
    : "Start new session to test latest config";
  const configurationRefreshActionLabel = previewResetMode ? "Reset chat" : "Start new session";
  const stoppedActionLabel = previewResetMode ? "Reset chat" : "New session";
  const handleResetPreviewSession = async (): Promise<void> => {
    resourceDraft.clearActiveMentions();
    await model.handleResetSession();
  };
  const handleSessionControlClick = previewResetMode
    ? handleResetPreviewSession
    : model.handleStartNewSession;

  const handleUploadFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0 || fileUploadDisabled) {
      return;
    }

    const sessionId = toSessionId(await model.ensureActiveSession());

    await Promise.all(
      files.map(async (file) => {
        const pendingId = startSessionFileUpload(sessionId, file);

        try {
          markSessionFileUploadProgress(sessionId, pendingId, 35);
          const uploadedResource = await uploadSessionResource(sessionId, file);
          markSessionFileUploadProgress(sessionId, pendingId, 95);
          completeSessionFileUpload(sessionId, pendingId);
          resourceDraft.appendMention(sessionId, uploadedResource);
          await queryClient.invalidateQueries({ queryKey: sessionResourcesQueryKey(sessionId) });
        } catch {
          failSessionFileUpload(sessionId, pendingId);
        }
      }),
    );
  };

  const handleSend = async (): Promise<void> => {
    const sent = await model.handleSend({ sessionResourceMentions });

    if (sent) {
      resourceDraft.clearActiveMentions();
    }
  };

  const handleKeyDown = async (event: React.KeyboardEvent): Promise<void> => {
    const sent = await model.handleKeyDown(event, { sessionResourceMentions });

    if (sent) {
      resourceDraft.clearActiveMentions();
    }
  };

  return (
    <div className="bg-paper-200 flex h-full" data-testid="agent-session-panel">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <AgentSessionPanelHeader
          activeTitle={activeTitle}
          agentName={agentName}
          onSessionControlClick={handleSessionControlClick}
          pill={pill}
          reconnectingSubtitle={reconnectingSubtitle}
          sessionControlMode={sessionControlMode}
          sending={model.sending}
          sessionCount={model.sessionCount}
          tone={tone}
        />

        {isTruthy(model.sessionLoadError) ? (
          <div className="border-amber/30 bg-amber-bg text-amber-fg border-b px-4 py-2.5 text-[12px] leading-relaxed">
            {sessionLoadErrorMessage}
          </div>
        ) : null}

        {setupBlocked && model.readiness ? (
          <AgentReadinessBlockersBanner
            onRetryProviderCheck={() => void model.retryProviderCheck()}
            readiness={model.readiness}
            retrying={model.sending}
            summary={setupSummary}
          />
        ) : null}

        {model.configurationRefreshRequired ? (
          <div className="border-amber/30 bg-amber-bg border-b px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-amber-fg min-w-0 text-[12px] font-medium">
                {configurationRefreshMessage}
              </div>
              <Button onClick={() => void handleSessionControlClick()} size="xs" variant="outline">
                {configurationRefreshActionLabel}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {model.isConversationLoading ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-[13px]">
              Loading conversation…
            </div>
          ) : (
            <SessionMessageList
              messages={model.messages}
              messagesEndRef={model.messagesEndRef}
              streaming={model.streaming}
            />
          )}
        </div>

        <div className="relative z-10 mx-auto w-2/3 shrink-0 py-4">
          {stopped ? (
            <div
              className="border-destructive/25 bg-destructive/[0.05] mb-3 rounded-lg border px-3 py-2.5"
              role="alert"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-destructive text-[13px] font-semibold">Session stopped</div>
                  <div className="text-fg-2 mt-0.5 text-[12px] leading-relaxed">
                    {model.run.error?.message ??
                      "Start a new session after fixing runtime diagnostics."}
                  </div>
                </div>
                <Button
                  onClick={() => void handleSessionControlClick()}
                  size="sm"
                  variant="outline"
                >
                  {stoppedActionLabel}
                </Button>
              </div>
            </div>
          ) : null}

          {model.permissionRequests[0] ? (
            <div
              className="border-amber/30 bg-amber-bg text-amber-fg relative z-20 mb-3 rounded-lg border px-3 py-2.5"
              role="alert"
            >
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold">
                    {model.permissionRequests[0].title}
                  </div>
                  {isTruthy(model.permissionRequests[0].rawInput) ? (
                    <div className="text-amber-fg/80 mt-1 truncate font-mono text-[11px]">
                      {model.permissionRequests[0].rawInput}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    aria-label="Dismiss permission request"
                    onClick={() =>
                      void model.resolvePermission(model.permissionRequests[0]!, "reject_once")
                    }
                    size="icon-sm"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                  <Button
                    onClick={() =>
                      void model.resolvePermission(model.permissionRequests[0]!, "reject_once")
                    }
                    size="sm"
                    variant="ghost"
                  >
                    Reject once
                  </Button>
                  <Button
                    onClick={() =>
                      void model.resolvePermission(model.permissionRequests[0]!, "allow_once")
                    }
                    size="sm"
                  >
                    Allow once
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <SessionComposer
            composerError={model.composerError}
            fileUploadDisabled={fileUploadDisabled}
            fileUploadDisabledReason={fileUploadDisabledReason}
            fileInputRef={model.fileInputRef}
            input={model.input}
            inputRef={model.inputRef}
            onKeyDown={(event) => void handleKeyDown(event)}
            onFilesSelected={(files) => void handleUploadFiles(files)}
            onSend={() => void handleSend()}
            pendingSessionFiles={pendingSessionFiles}
            sending={model.sending}
            sessionResourceMentions={sessionResourceMentions}
            setInput={model.setInput}
            streaming={model.streaming}
            sendDisabledReason={sendDisabledReason}
          />
        </div>
      </div>
    </div>
  );
}
