import { Check, ChevronDown, Code, Copy, Inbox, Upload } from "lucide-react";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";

import { useTranslation } from "@/shared/i18n";
import { writeClipboardText } from "@/shared/lib/clipboard";
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
  onPublish: () => void;
}

export function PublishMenu({
  agent,
  busy,
  disabled,
  errorMessage,
  onApiAccessClick,
  onPublish,
}: PublishMenuProps): ReactElement {
  const { t } = useTranslation();
  const isLive = agent.status === "published";
  const distribution = useMemo(() => buildAgentDistribution(agent), [agent]);
  const [copiedInstruction, setCopiedInstruction] = useState(false);

  const triggerLabel = busy
    ? isLive
      ? t("agentLifecycle.republishing")
      : t("agentLifecycle.publishing")
    : isLive
      ? t("agentLifecycle.republish")
      : t("agentLifecycle.publish");

  async function handleInstructionCopy(): Promise<void> {
    const prompt = buildAgentInstructionPrompt(agent, distribution, t);
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
              {isLive ? t("agentLifecycle.republishUpdate") : t("agentLifecycle.publish")}
            </span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              {isLive
                ? t("agentLifecycle.republishDescription")
                : t("agentLifecycle.publishDescription")}
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
          {t("agentLifecycle.distribution")}
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
            <span className="text-[13px] font-medium">{t("agentLifecycle.instructionForLlm")}</span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              {copiedInstruction
                ? t("agentLifecycle.copiedToClipboard")
                : t("agentLifecycle.copyInstructionDescription")}
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
            <span className="text-[13px] font-medium">{t("agentLifecycle.apiAccess")}</span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              {t("agentLifecycle.apiAccessDescription")}
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
            <span className="text-[13px] font-medium">{t("pageTitle.thread")}</span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              {t("agentLifecycle.threadDescription")}
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
