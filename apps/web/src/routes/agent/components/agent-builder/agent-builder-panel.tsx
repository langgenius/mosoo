import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { AgentBuilderDraftPatchSectionId } from "@mosoo/contracts/agent-builder";
import { SendHorizontal } from "lucide-react";
import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import type { ReactElement } from "react";

import type { AgentBuilderMessage } from "@/domains/agent-builder/api/agent-builder-client";
import { useAgentBuilderSystemAgentSession } from "@/domains/agent-builder/query/use-agent-builder-system-agent-session";
import { Button } from "@/shared/ui/button";

import type { Agent } from "../../agent.types";
import { createAgentBuilderStructuredReplyText } from "./agent-builder-ask-user-card";
import type { AgentBuilderStructuredReply } from "./agent-builder-ask-user-card";
import { useAgentBuilderAssistantRuntime } from "./agent-builder-assistant-runtime";
import { createAutoApplyDraftPatch } from "./agent-builder-auto-apply";
import type {
  AgentBuilderClientPatch,
  AgentBuilderPatchApplyResult,
} from "./agent-builder-auto-apply";
import { AgentBuilderMessageCard } from "./agent-builder-message-card";
import type { AgentBuilderActionDisabled } from "./agent-builder-message-card";
import { getLatestActionableStructuredReplyMessageId } from "./agent-builder-structured-reply-state";
import { canSubmitAgentBuilderTurn } from "./agent-builder-submit-gate";

function combineBuilderActionDisabled(input: {
  readonly actionDisabled: AgentBuilderActionDisabled;
  readonly builderBusy: boolean;
}): AgentBuilderActionDisabled {
  if (input.builderBusy) {
    return true;
  }

  return input.actionDisabled;
}

export function AgentBuilderPanel({
  agent,
  actionDisabled = false,
  actionError = null,
  actionPending = false,
  draftRevision,
  draftYaml,
  onAction,
  onDraftPatchAutoApply,
  onDraftPatchFocus,
}: {
  agent: Agent;
  actionDisabled?: AgentBuilderActionDisabled | undefined;
  actionError?: string | null | undefined;
  actionPending?: boolean | undefined;
  draftRevision: string;
  draftYaml: string;
  onAction?: ((actionKey: string) => void) | undefined;
  onDraftPatchAutoApply?:
    | ((
        patch: AgentBuilderClientPatch,
      ) => AgentBuilderPatchApplyResult | Promise<AgentBuilderPatchApplyResult>)
    | undefined;
  onDraftPatchFocus?: ((sectionId: AgentBuilderDraftPatchSectionId) => void) | undefined;
}): ReactElement {
  const [inputText, setInputText] = useState("");
  const [clientPatchError, setClientPatchError] = useState<string | null>(null);
  const [autoApplyPending, setAutoApplyPending] = useState(false);
  const applyAutoPatch = useCallback(
    async (turnMessages: AgentBuilderMessage[]): Promise<void> => {
      const patch = createAutoApplyDraftPatch(turnMessages);

      if (patch === null) {
        setClientPatchError(null);
        return;
      }

      setAutoApplyPending(true);

      try {
        const result = await onDraftPatchAutoApply?.(patch);
        const blockedItem = result?.blockedItems[0];
        setClientPatchError(blockedItem?.reason ?? result?.saveError ?? null);
      } finally {
        setAutoApplyPending(false);
      }
    },
    [onDraftPatchAutoApply],
  );
  const systemAgentSession = useAgentBuilderSystemAgentSession({
    agentId: agent.id,
    draftRevision,
    draftYaml,
    onError: setClientPatchError,
    onTurnMessages: applyAutoPatch,
  });
  const scrollMessageEnd = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ block: "end" });
  }, []);
  const normalizedInput = inputText.trim();
  const canSubmitBuilderTurn = canSubmitAgentBuilderTurn({
    actionPending,
    autoApplyPending,
    historyError: systemAgentSession.historyError,
    systemAgentBusy: systemAgentSession.isBusy,
    systemAgentReady: systemAgentSession.systemAgent !== null,
  });
  const canSubmit = normalizedInput.length > 0 && canSubmitBuilderTurn;
  const submitSystemAgentTurn = systemAgentSession.submitTurn;
  const submitBuilderTurn = useCallback(
    (submittedInput: string) => {
      if (!canSubmitBuilderTurn) {
        return;
      }

      setInputText("");
      setClientPatchError(null);
      submitSystemAgentTurn(submittedInput);
    },
    [canSubmitBuilderTurn, submitSystemAgentTurn],
  );
  const assistantRuntime = useAgentBuilderAssistantRuntime({
    isBusy: systemAgentSession.isBusy || autoApplyPending,
    isSendDisabled: !canSubmitBuilderTurn,
    messages: systemAgentSession.messages,
    onSubmit: submitBuilderTurn,
  });
  const combinedActionDisabled = combineBuilderActionDisabled({
    actionDisabled: actionDisabled ?? false,
    builderBusy: !canSubmitBuilderTurn,
  });
  const latestActionableStructuredReplyMessageId = getLatestActionableStructuredReplyMessageId(
    systemAgentSession.messages,
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const submittedInput = normalizedInput;
    submitBuilderTurn(submittedInput);
  };

  const handleStructuredReply = (reply: AgentBuilderStructuredReply) => {
    submitBuilderTurn(createAgentBuilderStructuredReplyText(reply));
  };

  return (
    <AssistantRuntimeProvider runtime={assistantRuntime}>
      <div className="bg-bg-1 flex h-full min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {systemAgentSession.historyError !== null ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-[12px]">
              {systemAgentSession.historyError.message}
            </div>
          ) : systemAgentSession.messages.length > 0 ? (
            <div className="space-y-3">
              {systemAgentSession.messages.map((message) => (
                <AgentBuilderMessageCard
                  key={message.id}
                  message={message}
                  onAction={onAction}
                  onDraftPatchFocus={onDraftPatchFocus}
                  onStructuredReply={handleStructuredReply}
                  actionDisabled={combinedActionDisabled}
                  structuredReplyDisabled={
                    !canSubmitBuilderTurn || message.id !== latestActionableStructuredReplyMessageId
                  }
                />
              ))}
              <div key={systemAgentSession.messages.length} ref={scrollMessageEnd} />
            </div>
          ) : (
            <div className="border-border-subtle rounded-xl border bg-white p-4">
              <div className="text-foreground text-[13px] font-medium">No Builder messages yet</div>
              <div className="text-muted-foreground mt-1.5 text-[12px] leading-relaxed">
                This thread is scoped to this Agent Draft. Describe what you want to create or
                change, and Builder will update the configuration alongside the form.
              </div>
            </div>
          )}
        </div>

        <div className="border-border-subtle shrink-0 border-t p-3">
          {systemAgentSession.visibleChatError !== undefined ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive mb-2 rounded-lg border px-3 py-2 text-[12px]">
              {systemAgentSession.visibleChatError.message}
            </div>
          ) : null}
          {clientPatchError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive mb-2 rounded-lg border px-3 py-2 text-[12px]">
              {clientPatchError}
            </div>
          ) : null}
          {actionError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive mb-2 rounded-lg border px-3 py-2 text-[12px]">
              {actionError}
            </div>
          ) : null}
          <form
            className="border-border flex items-center gap-2 rounded-lg border bg-white px-3 py-2"
            onSubmit={handleSubmit}
          >
            <input
              aria-label="Message Agent Builder"
              className="placeholder:text-muted-foreground/50 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              maxLength={4000}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Message Agent Builder"
              value={inputText}
            />
            <Button disabled={!canSubmit} size="icon-sm" type="submit">
              <SendHorizontal />
            </Button>
          </form>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
