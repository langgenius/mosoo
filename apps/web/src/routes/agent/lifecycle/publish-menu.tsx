import { Check, ChevronDown, Code, Copy, Inbox, MessageSquare, Upload } from "lucide-react";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import type { Agent } from "../agent.types";
import { buildAgentDistribution, buildAgentInstructionPrompt } from "./distribution-info";

export interface PublishMenuProps {
  agent: Agent;
  busy: boolean;
  disabled: boolean;
  errorMessage: string | null;
  onApiAccessClick: () => void;
  onChannelClick?: () => void;
  onPublish: () => void;
  showChannelSetup?: boolean;
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function PublishMenu({
  agent,
  busy,
  disabled,
  errorMessage,
  onApiAccessClick,
  onChannelClick,
  onPublish,
  showChannelSetup = false,
}: PublishMenuProps): ReactElement {
  const isLive = agent.status === "published";
  const distribution = useMemo(() => buildAgentDistribution(agent), [agent]);
  const [copiedInstruction, setCopiedInstruction] = useState(false);

  const triggerLabel = busy
    ? isLive
      ? "Republishing…"
      : "Publishing…"
    : isLive
      ? "Re-publish"
      : "Publish";

  async function handleInstructionCopy(): Promise<void> {
    const prompt = buildAgentInstructionPrompt(agent, distribution);
    const didCopy = await writeClipboardText(prompt);
    if (!didCopy) {
      return;
    }

    setCopiedInstruction(true);
    globalThis.setTimeout(() => {
      setCopiedInstruction(false);
    }, 1500);
  }

  function handleOpenThread(): void {
    globalThis.location.assign(distribution.threadsPath);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="gap-1.5" disabled={disabled || busy} size="sm">
          <Upload className="size-3.5" />
          {triggerLabel}
          <ChevronDown className="-mr-0.5 size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[300px]">
        <DropdownMenuItem
          className="items-start gap-2.5 py-2"
          disabled={disabled || busy}
          onSelect={() => {
            onPublish();
          }}
        >
          <Upload className="mt-0.5 size-4" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] font-medium">
              {isLive ? "Republish update" : "Publish"}
            </span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              {isLive
                ? "Push the latest config live for all callers."
                : "Make this agent reachable across all surfaces."}
            </span>
          </div>
        </DropdownMenuItem>
        {errorMessage ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive mx-1 mt-0.5 mb-1 rounded-sm border px-2 py-1.5 text-[11.5px]">
            {errorMessage}
          </div>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10.5px] tracking-wide uppercase">
          Distribution
        </DropdownMenuLabel>
        <DropdownMenuItem
          className="items-start gap-2.5 py-2"
          disabled={!isLive}
          onSelect={(event) => {
            event.preventDefault();
            void handleInstructionCopy();
          }}
        >
          {copiedInstruction ? (
            <Check className="mt-0.5 size-4" />
          ) : (
            <Copy className="mt-0.5 size-4" />
          )}
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] font-medium">Instruction for LLM</span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              {copiedInstruction
                ? "Copied to clipboard."
                : "Copy coding-agent instructions for this agent."}
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="items-start gap-2.5 py-2"
          disabled={!isLive}
          onSelect={(event) => {
            event.preventDefault();
            onApiAccessClick();
          }}
        >
          <Code className="mt-0.5 size-4" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] font-medium">API Access</span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              Agent ID · API token · API reference.
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="items-start gap-2.5 py-2"
          disabled={!isLive}
          onSelect={handleOpenThread}
        >
          <Inbox className="mt-0.5 size-4" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] font-medium">Thread</span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              Start a thread with this agent in Mosoo.
            </span>
          </div>
        </DropdownMenuItem>
        {showChannelSetup ? (
          <DropdownMenuItem
            className="items-start gap-2.5 py-2"
            disabled={!isLive}
            onSelect={(event) => {
              event.preventDefault();
              onChannelClick?.();
            }}
          >
            <MessageSquare className="mt-0.5 size-4" />
            <div className="flex min-w-0 flex-col">
              <span className="text-[13px] font-medium">Channel</span>
              <span className="text-muted-foreground text-[11.5px] leading-snug">
                Slack · Lark · Discord · Telegram · WeChat
              </span>
            </div>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
