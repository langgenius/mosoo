import type { AgentBuilderDraftPatchSectionId } from "@mosoo/contracts/agent-builder";
import { SendHorizontal } from "lucide-react";
import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import type { ReactElement } from "react";

import type { AgentBuilderMessage } from "@/domains/agent-builder/api/agent-builder-client";
import { useApproveAgentBuilderStarterPackMutation } from "@/domains/agent-builder/query/agent-builder-queries";
import { useAgentBuilderSystemAgentSession } from "@/domains/agent-builder/query/use-agent-builder-system-agent-session";
import { Button } from "@/shared/ui/button";

import type { Agent } from "../../agent.types";
import { createAutoApplyDraftPatch } from "./agent-builder-auto-apply";
import type {
  AgentBuilderClientPatch,
  AgentBuilderPatchApplyResult,
} from "./agent-builder-auto-apply";
import { AgentBuilderMessageCard } from "./agent-builder-message-card";
import {
  createStarterPackBatchApprovalInput,
  createStarterPackSingleApprovalInput,
} from "./starter-pack-approval-submission";
import type {
  AgentBuilderStarterPackBatchApprovalSubmission,
  AgentBuilderStarterPackSingleApprovalSubmission,
} from "./starter-pack-approval-submission";

export function AgentBuilderPanel({
  agent,
  draftRevision,
  draftYaml,
  onDraftPatchAutoApply,
  onDraftPatchFocus,
}: {
  agent: Agent;
  draftRevision: string;
  draftYaml: string;
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
  const approveStarterPackMutation = useApproveAgentBuilderStarterPackMutation(
    agent.id,
    systemAgentSession.systemAgent,
  );
  const normalizedInput = inputText.trim();
  const canSubmitBuilderTurn =
    systemAgentSession.systemAgent !== null &&
    !approveStarterPackMutation.isPending &&
    !systemAgentSession.isBusy &&
    !autoApplyPending &&
    systemAgentSession.historyError === null;
  const canSubmit = normalizedInput.length > 0 && canSubmitBuilderTurn;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const submittedInput = normalizedInput;
    setInputText("");
    setClientPatchError(null);
    systemAgentSession.submitTurn(submittedInput);
  };

  const handleApproveStarterPackItem = (
    submission: AgentBuilderStarterPackSingleApprovalSubmission,
  ) => {
    approveStarterPackMutation.mutate(createStarterPackSingleApprovalInput(submission), {
      onSuccess: (turnMessages) => {
        void applyAutoPatch(turnMessages);
      },
    });
  };

  const handleApproveStarterPackBatch = (
    submission: AgentBuilderStarterPackBatchApprovalSubmission,
  ) => {
    approveStarterPackMutation.mutate(createStarterPackBatchApprovalInput(submission), {
      onSuccess: (turnMessages) => {
        void applyAutoPatch(turnMessages);
      },
    });
  };

  return (
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
                onDraftPatchFocus={onDraftPatchFocus}
                onStarterPackApproveAll={handleApproveStarterPackBatch}
                onStarterPackApproveItem={handleApproveStarterPackItem}
                starterPackApprovalsDisabled={!canSubmitBuilderTurn}
              />
            ))}
            <div key={systemAgentSession.messages.length} ref={scrollMessageEnd} />
          </div>
        ) : (
          <div className="border-border-subtle rounded-xl border bg-white p-4">
            <div className="text-foreground text-[13px] font-medium">No Builder messages yet</div>
            <div className="text-muted-foreground mt-1.5 text-[12px] leading-relaxed">
              The thread is already scoped to this Agent Draft. Send a first turn to record it
              against this history; the Planner will start interpreting turns in the next slice.
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
        {approveStarterPackMutation.isError ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive mb-2 rounded-lg border px-3 py-2 text-[12px]">
            {approveStarterPackMutation.error instanceof Error
              ? approveStarterPackMutation.error.message
              : "Failed to approve Starter Pack action."}
          </div>
        ) : null}
        {clientPatchError ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive mb-2 rounded-lg border px-3 py-2 text-[12px]">
            {clientPatchError}
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
  );
}
