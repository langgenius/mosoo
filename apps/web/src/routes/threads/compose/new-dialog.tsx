import type { AgentSummary } from "@mosoo/contracts/agent";
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  FileText,
  Maximize2,
  Minimize2,
  Paperclip,
  Plus,
  Send,
  X,
} from "lucide-react";
import { useMemo, useReducer, useRef } from "react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Textarea } from "@/shared/ui/textarea";

import { AgentAvatar } from "../agent-avatar";

export interface NewThreadSubmitInput {
  agentId: string;
  body: string;
  files: File[];
}

interface NewThreadDialogProps {
  agents: AgentSummary[];
  error: string | null;
  lastAgentId: string | null;
  lockedAgentId: string | null;
  onLastAgentChange: (agentId: string | null) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: NewThreadSubmitInput) => Promise<void>;
  open: boolean;
  submitting: boolean;
}

function AgentBadge({
  agent,
  size,
}: {
  agent: AgentSummary | null;
  size: "lg" | "sm";
}): ReactElement {
  const dimensions = size === "lg" ? "size-7 text-[11px]" : "size-6 text-[10px]";

  return (
    <AgentAvatar
      agent={agent}
      defaultName={agent?.name ?? "Agent"}
      className={dimensions}
      placeholder={<Bot className="text-fg-3 size-3.5" />}
    />
  );
}

function getDefaultAgentId(input: {
  agents: readonly AgentSummary[];
  lastAgentId: string | null;
  lockedAgentId: string | null;
}): string | null {
  if (input.lockedAgentId !== null) {
    return input.lockedAgentId;
  }

  if (input.lastAgentId === null) {
    return null;
  }

  const lastAgent = input.agents.find((agent) => agent.id === input.lastAgentId);

  if (lastAgent !== undefined) {
    return lastAgent.id;
  }

  return null;
}

interface NewThreadDialogState {
  body: string;
  discardWarning: boolean;
  expanded: boolean;
  files: File[];
  selectedAgentId: string | null;
}

type NewThreadDialogAction =
  | { type: "addFiles"; files: File[] }
  | { type: "changeBody"; body: string }
  | { type: "removeFile"; index: number }
  | { type: "setDiscardWarning"; warning: boolean }
  | { type: "setSelectedAgentId"; agentId: string | null }
  | { type: "toggleExpanded" };

function createNewThreadDialogState(input: {
  agents: readonly AgentSummary[];
  lastAgentId: string | null;
  lockedAgentId: string | null;
}): NewThreadDialogState {
  return {
    body: "",
    discardWarning: false,
    expanded: false,
    files: [],
    selectedAgentId: getDefaultAgentId(input),
  };
}

function newThreadDialogReducer(
  state: NewThreadDialogState,
  action: NewThreadDialogAction,
): NewThreadDialogState {
  switch (action.type) {
    case "addFiles":
      return { ...state, files: [...state.files, ...action.files] };
    case "changeBody":
      return { ...state, body: action.body, discardWarning: false };
    case "removeFile":
      return {
        ...state,
        files: state.files.filter((_file, index) => index !== action.index),
      };
    case "setDiscardWarning":
      return { ...state, discardWarning: action.warning };
    case "setSelectedAgentId":
      return { ...state, selectedAgentId: action.agentId };
    case "toggleExpanded":
      return { ...state, expanded: !state.expanded };
  }
}

function AgentAssignField({
  agents,
  locked,
  noAgentsAvailable,
  onCreateAgent,
  onSelectAgent,
  selectedAgent,
  selectedAgentId,
}: {
  agents: AgentSummary[];
  locked: boolean;
  noAgentsAvailable: boolean;
  onCreateAgent: () => void;
  onSelectAgent: (agentId: string) => void;
  selectedAgent: AgentSummary | null;
  selectedAgentId: string | null;
}): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <span className="text-fg-3 shrink-0 text-[10.5px] font-bold tracking-[0.16em] uppercase">
        Assign to
      </span>
      {noAgentsAvailable ? (
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-10 min-w-0 flex-1 justify-between gap-2 px-2.5 py-1.5 text-left"
          onClick={onCreateAgent}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="bg-muted/40 text-fg-3 inline-flex size-6 shrink-0 items-center justify-center rounded-full">
              <Plus className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-fg-1 block truncate text-[13px] leading-snug font-semibold">
                Create your first agent
              </span>
              <span className="text-fg-3 block truncate text-[11.5px] leading-snug">
                No agents yet; set one up to dispatch this thread.
              </span>
            </span>
          </span>
          <ArrowUpRight className="text-fg-3 size-4 shrink-0" />
        </Button>
      ) : locked ? (
        <div
          aria-readonly="true"
          className="border-border-strong bg-card dark:border-input dark:bg-input/30 flex h-auto min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left"
        >
          <AgentBadge agent={selectedAgent} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="text-fg-1 block truncate text-[13px] leading-snug font-semibold">
              {selectedAgent?.name ?? "Select an agent"}
            </span>
            {selectedAgent?.description ? (
              <span className="text-fg-3 block truncate text-[11.5px] leading-snug">
                {selectedAgent.description}
              </span>
            ) : null}
          </span>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-auto min-h-10 min-w-0 flex-1 justify-between gap-2 px-2.5 py-1.5 text-left"
            >
              <span className="flex min-w-0 items-center gap-2">
                <AgentBadge agent={selectedAgent} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="text-fg-1 block truncate text-[13px] leading-snug font-semibold">
                    {selectedAgent?.name ?? "Select an agent"}
                  </span>
                  {selectedAgent?.description ? (
                    <span className="text-fg-3 block truncate text-[11.5px] leading-snug">
                      {selectedAgent.description}
                    </span>
                  ) : null}
                </span>
              </span>
              <ChevronDown className="text-fg-3 size-4 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[320px] w-[var(--anchor-width)] overflow-y-auto">
            {agents.map((agent) => {
              const isSelected = agent.id === selectedAgentId;

              return (
                <DropdownMenuItem
                  key={agent.id}
                  disabled={agent.status !== "published"}
                  onSelect={() => {
                    onSelectAgent(agent.id);
                  }}
                  className="items-start gap-2.5 py-2"
                >
                  <AgentBadge agent={agent} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-fg-1 truncate text-[13px] font-semibold">
                        {agent.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-sm border px-1 py-0.5 text-[9.5px] font-bold uppercase tracking-wide",
                          agent.kind === "pet"
                            ? "border-soil/25 bg-soil-bg text-soil-fg"
                            : "border-sky/30 bg-sky-bg text-sky-fg",
                        )}
                      >
                        {agent.kind}
                      </span>
                      {agent.status !== "published" ? (
                        <span className="text-fg-3 shrink-0 text-[10.5px]">draft</span>
                      ) : null}
                    </div>
                    {agent.description ? (
                      <div className="text-fg-3 mt-0.5 line-clamp-2 text-[11.5px] leading-snug">
                        {agent.description}
                      </div>
                    ) : null}
                  </div>
                  {isSelected ? (
                    <Check className="text-accent-press mt-1 size-3.5 shrink-0" />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function NewThreadDialog({
  agents,
  error,
  lastAgentId,
  lockedAgentId,
  onLastAgentChange,
  onOpenChange,
  onSubmit,
  open,
  submitting,
}: NewThreadDialogProps): ReactElement {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, dispatch] = useReducer(
    newThreadDialogReducer,
    { agents, lastAgentId, lockedAgentId },
    createNewThreadDialogState,
  );
  const { body, discardWarning, expanded, files, selectedAgentId } = state;
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );
  const locked = lockedAgentId !== null;
  const missingLockedAgent = locked && selectedAgent === null;
  const draftSelected = selectedAgent?.status === "draft";
  const noAgentsAvailable = !locked && agents.length === 0;
  const canSubmit =
    body.trim().length > 0 && selectedAgent !== null && !draftSelected && !submitting;
  const charCount = body.trim().length;

  async function submit(): Promise<void> {
    if (!canSubmit || selectedAgent === null) {
      return;
    }

    onLastAgentChange(selectedAgent.id);
    await onSubmit({
      agentId: selectedAgent.id,
      body: body.trim(),
      files,
    });
  }

  function requestOpenChange(nextOpen: boolean): void {
    if (!nextOpen && body.trim().length > 0 && !discardWarning) {
      dispatch({ type: "setDiscardWarning", warning: true });
      return;
    }

    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        className={cn("gap-0 p-0", expanded ? "sm:max-w-[1100px]" : "sm:max-w-[760px]")}
      >
        <DialogHeader className="border-border-subtle border-b px-5 py-3">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="text-fg-1 text-[14px] font-semibold">New thread</DialogTitle>
              <DialogDescription className="sr-only">
                Start a Thread for one Agent.
              </DialogDescription>
            </div>
            <Button
              aria-label={expanded ? "Collapse composer" : "Expand composer"}
              size="icon-sm"
              type="button"
              variant="ghost"
              onClick={() => {
                dispatch({ type: "toggleExpanded" });
              }}
            >
              {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 px-5 py-4">
          <AgentAssignField
            agents={agents}
            locked={locked}
            noAgentsAvailable={noAgentsAvailable}
            onCreateAgent={() => {
              const basePath = globalThis.location.pathname.startsWith("/demo")
                ? "/demo/agent"
                : "/agent";
              onOpenChange(false);
              void navigate(basePath);
            }}
            onSelectAgent={(agentId) => {
              dispatch({ agentId, type: "setSelectedAgentId" });
            }}
            selectedAgent={selectedAgent}
            selectedAgentId={selectedAgentId}
          />

          <div className="border-border-subtle bg-card focus-within:border-ring focus-within:ring-ring/50 rounded-lg border px-3.5 py-3 shadow-[var(--shadow-sm)] transition-[color,box-shadow] focus-within:ring-[3px]">
            <Textarea
              value={body}
              onChange={(event) => {
                dispatch({ body: event.target.value, type: "changeBody" });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void submit();
                }
              }}
              className={cn(
                "resize-none border-0 bg-transparent p-0 text-[14px] leading-relaxed shadow-none focus-visible:ring-0",
                expanded ? "min-h-[420px]" : "min-h-[280px]",
              )}
              placeholder="Describe the goal, context, and success criteria for this task..."
            />
          </div>

          {files.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {files.map((file, index) => (
                <span
                  key={`${file.name}:${file.size}:${index}`}
                  className="border-border bg-muted/35 text-fg-2 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
                >
                  <FileText className="size-3 shrink-0" />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      dispatch({ index, type: "removeFile" });
                    }}
                    className="text-fg-3 hover:text-fg-1"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {missingLockedAgent ? (
            <div className="border-destructive/20 bg-destructive/[0.06] text-destructive rounded-md border px-3 py-2 text-[12.5px]">
              This Agent is not available in this App.
            </div>
          ) : null}

          {draftSelected ? (
            <div className="border-amber/30 bg-amber-bg text-amber-fg rounded-md border px-3 py-2 text-[12.5px]">
              Publish this Agent before starting a Thread.
            </div>
          ) : null}

          {error ? (
            <div className="border-destructive/20 bg-destructive/[0.06] text-destructive rounded-md border px-3 py-2 text-[12.5px]">
              {error}
            </div>
          ) : null}

          {discardWarning ? (
            <div className="border-amber/30 bg-amber-bg text-amber-fg rounded-md border px-3 py-2 text-[12.5px]">
              Closing will discard this draft.
            </div>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          aria-label="Attach files to thread"
          className="hidden"
          onChange={(event) => {
            const selectedFiles = event.target.files;

            if (selectedFiles) {
              dispatch({ files: [...selectedFiles], type: "addFiles" });
            }

            event.target.value = "";
          }}
        />

        <DialogFooter className="border-border-subtle gap-2 border-t px-5 py-3">
          <div className="mr-auto flex items-center gap-2">
            <Button
              aria-label="Attach files"
              size="icon-xs"
              type="button"
              variant="ghost"
              className="text-fg-3"
              onClick={() => {
                fileInputRef.current?.click();
              }}
            >
              <Paperclip className="size-3.5" />
            </Button>
            <span className="text-fg-3 text-[11.5px] tabular-nums">
              {charCount.toLocaleString()} chars
            </span>
          </div>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              void submit();
            }}
            className={cn(submitting && "opacity-70")}
          >
            <Send className="size-3.5" />
            {submitting ? "Dispatching" : "Dispatch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
