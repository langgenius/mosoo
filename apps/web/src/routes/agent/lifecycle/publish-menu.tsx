import { ChevronDown, Code, FileDown, Inbox, Upload } from "lucide-react";
import type { ReactElement } from "react";
import { useMemo } from "react";

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
import { downloadTextFile } from "../components/settings-dialog-model";
import { buildAgentApiCurl, buildAgentDistribution } from "./distribution-info";
import type { AgentDistribution } from "./distribution-info";

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
  const isLive = agent.status === "published";
  const distribution = useMemo(() => buildAgentDistribution(agent), [agent]);

  const triggerLabel = busy
    ? isLive
      ? "Republishing…"
      : "Publishing…"
    : isLive
      ? "Re-publish"
      : "Publish";

  function handleSkillDownload(): void {
    const markdown = buildAgentSkillMarkdown(agent, distribution);
    downloadTextFile(
      `${agentFileSlug(agent.name)}-skill.md`,
      "text/markdown;charset=utf-8",
      markdown,
    );
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
          onSelect={handleSkillDownload}
        >
          <FileDown className="mt-0.5 size-4" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[13px] font-medium">skill.md</span>
            <span className="text-muted-foreground text-[11.5px] leading-snug">
              Drop into another AI system that reads skill manifests.
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function agentFileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "")
    .slice(0, 48);
  return slug || "agent";
}

function buildAgentSkillMarkdown(agent: Agent, distribution: AgentDistribution): string {
  const description = agent.description.trim() || "No description provided.";
  const kindHint =
    agent.kind === "pet"
      ? "Conversational chat agent designed for back-and-forth dialogue."
      : "Job-style agent designed for one-shot calls that return a structured result.";

  return [
    `# ${agent.name}`,
    "",
    description,
    "",
    `> ${kindHint}`,
    "",
    "## How to use",
    "",
    "Call this agent over HTTP with a bearer token issued from your Mosoo API Tokens settings.",
    "",
    "```bash",
    buildAgentApiCurl(agent),
    "```",
    "",
    "The create-thread response returns `thread/run`; continue the conversation via the Thread API.",
    "",
    `Docs: ${distribution.apiDocsUrl}`,
    "",
    "<!-- Generated by Mosoo · skill.md v0 -->",
    "",
  ].join("\n");
}
