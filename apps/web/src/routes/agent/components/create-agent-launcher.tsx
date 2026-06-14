import type { AppId } from "@mosoo/contracts/id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, PenLine } from "lucide-react";
import { useState } from "react";
import type { CSSProperties, FormEvent, ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { stashAgentBuilderInitialMessage } from "@/domains/agent-builder/initial-message";
import { createAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { useVendorCredentialsQuery } from "@/domains/vendor-credential/model/provider-credential-query";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";

import { DEFAULT_AGENT_NAME } from "../draft-stages";
import { resolveDefaultAgentRuntime } from "../runtime-default";

const TITLE_STYLE = { letterSpacing: "0" } satisfies CSSProperties;

interface AgentTemplate {
  readonly description: string;
  readonly key: string;
  readonly message: string;
  readonly title: string;
}

const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    description: "Answers repeat questions in Slack.",
    key: "slack-qa-assistant",
    message:
      "Create a Slack Q&A assistant that answers my team's repeat questions. It should stay concise, cite the source it used, and ask a clarifying question when the request is ambiguous.",
    title: "Slack Q&A assistant",
  },
  {
    description: "Captures and routes tasks for you.",
    key: "task-triager",
    message:
      "Create a task triager that captures incoming requests, classifies them by urgency and topic, and routes each task to the right owner with a short summary.",
    title: "Task triager",
  },
  {
    description: "Writes and sends weekly status updates.",
    key: "weekly-status-reporter",
    message:
      "Create a weekly status reporter that collects what shipped this week, drafts a crisp status update grouped by app, and prepares it for review every Friday.",
    title: "Weekly status reporter",
  },
  {
    description: "Pulls updates from your tools each morning.",
    key: "morning-brief",
    message:
      "Create a morning brief agent that pulls overnight updates from my connected tools and writes a short prioritized digest I can read in two minutes.",
    title: "Morning brief",
  },
];

export function CreateAgentLauncherDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const { activeOrganization, activeApp } = useAppSession();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[640px]"
      >
        {activeOrganization === null ? (
          <div className="text-muted-foreground px-7 py-10 text-center text-[13px]">
            Join an organization to create agents.
          </div>
        ) : activeApp === null ? (
          <div className="text-muted-foreground px-7 py-10 text-center text-[13px]">
            Create an App before creating agents.
          </div>
        ) : (
          <CreateAgentLauncherBody onOpenChange={onOpenChange} appId={activeApp.id} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateAgentLauncherBody({
  onOpenChange,
  appId,
}: {
  onOpenChange: (open: boolean) => void;
  appId: AppId;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { credentials, loading: credentialsLoading } = useVendorCredentialsQuery(appId);
  const [freeText, setFreeText] = useState("");
  const [pendingSource, setPendingSource] = useState<"blank" | "builder" | null>(null);
  const createAgentMutation = useMutation({
    mutationFn: createAgent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
  const creating = pendingSource !== null;
  const createDisabled = creating || credentialsLoading;

  function navigateToAgent(agentId: string): void {
    void navigate(
      globalThis.location.pathname.startsWith("/demo")
        ? `/demo/agent/${agentId}`
        : `/agent/${agentId}`,
    );
  }

  async function createDraftAgent(): Promise<string | null> {
    const runtime = resolveDefaultAgentRuntime(credentials);

    if (runtime === null) {
      return null;
    }

    const createdAgent = await createAgentMutation.mutateAsync({
      kind: "pet",
      model: runtime.model,
      name: DEFAULT_AGENT_NAME,
      appId,
      prompt: "",
      provider: runtime.provider,
      runtimeId: runtime.runtimeId,
      skillIds: [],
    });

    return createdAgent.id;
  }

  async function handleStartFromBlank(): Promise<void> {
    if (createDisabled) {
      return;
    }

    setPendingSource("blank");

    try {
      const agentId = await createDraftAgent();

      if (agentId !== null) {
        onOpenChange(false);
        navigateToAgent(agentId);
      }
    } catch {
      // Error state is surfaced from the mutation object.
    } finally {
      setPendingSource(null);
    }
  }

  async function handleBuilderStart(message: string): Promise<void> {
    const trimmedMessage = message.trim();

    if (createDisabled || trimmedMessage.length === 0) {
      return;
    }

    setPendingSource("builder");

    try {
      const agentId = await createDraftAgent();

      if (agentId !== null) {
        stashAgentBuilderInitialMessage(agentId, trimmedMessage);
        onOpenChange(false);
        navigateToAgent(agentId);
      }
    } catch {
      // Error state is surfaced from the mutation object.
    } finally {
      setPendingSource(null);
    }
  }

  function handleFreeTextSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void handleBuilderStart(freeText);
  }

  return (
    <div className="px-7 pt-6 pb-7">
      <div className="flex justify-end pr-7">
        <Button
          disabled={createDisabled}
          onClick={() => void handleStartFromBlank()}
          size="xs"
          variant="ghost"
        >
          <PenLine />
          {pendingSource === "blank" ? "Creating…" : "Start from blank"}
        </Button>
      </div>

      <DialogTitle asChild>
        <h2 className="mt-4 text-center text-[20px] font-light" style={TITLE_STYLE}>
          What should your agent do?
        </h2>
      </DialogTitle>

      <form
        className="border-brand/40 focus-within:border-brand mx-auto mt-5 flex max-w-[480px] items-center gap-2 rounded-xl border-2 bg-white px-3.5 py-2.5"
        onSubmit={handleFreeTextSubmit}
      >
        <textarea
          aria-label="Describe your agent"
          className="placeholder:text-muted-foreground/50 max-h-32 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none"
          maxLength={4000}
          onChange={(event) => {
            setFreeText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleBuilderStart(freeText);
            }
          }}
          placeholder="Let AI build your agent…"
          rows={2}
          value={freeText}
        />
        <Button
          aria-label="Send to Agent Builder"
          disabled={createDisabled || freeText.trim().length === 0}
          size="icon-sm"
          type="submit"
        >
          <ArrowUp />
        </Button>
      </form>

      {credentialsLoading ? (
        <div className="text-muted-foreground mx-auto mt-3 max-w-[480px] text-center text-[12px]">
          Checking your configured providers…
        </div>
      ) : null}

      {createAgentMutation.error ? (
        <div className="text-destructive mx-auto mt-3 max-w-[480px] text-center text-[12px]">
          {createAgentMutation.error instanceof Error
            ? createAgentMutation.error.message
            : "Failed to create agent."}
        </div>
      ) : null}

      <div className="mt-7">
        <div className="text-muted-foreground text-[12px] font-medium">Use a template</div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {AGENT_TEMPLATES.map((template) => (
            <button
              className="border-border hover:border-brand/30 hover:bg-accent/30 flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60"
              disabled={createDisabled}
              key={template.key}
              onClick={() => void handleBuilderStart(template.message)}
              type="button"
            >
              <span className="text-foreground text-[12px] leading-snug font-medium">
                {template.title}
              </span>
              <span className="text-muted-foreground text-[11px] leading-snug">
                {template.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
