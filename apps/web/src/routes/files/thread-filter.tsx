import { Check, ChevronDown, Copy } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { useState } from "react";

import { writeClipboardText } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import type { FilesAgentOption, FilesSessionOption } from "./files-list-model";

interface ThreadFilterProps {
  agents: FilesAgentOption[];
  disabled: boolean;
  onChange: (sessionId: string) => void;
  sessions: FilesSessionOption[];
  value: string;
}

function formatThreadTitle(title: string | null): string {
  const normalized = title?.trim();
  return normalized ? normalized : "Untitled Thread";
}

export function ThreadFilter({
  agents,
  disabled,
  onChange,
  sessions,
  value,
}: ThreadFilterProps): ReactElement {
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const selectedSession = sessions.find((session) => session.id === value);
  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const selectedLabel =
    selectedSession === undefined ? "All Threads" : formatThreadTitle(selectedSession.title);

  async function handleCopy(
    event: MouseEvent<HTMLButtonElement>,
    sessionId: string,
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const didCopy = await writeClipboardText(sessionId);
    if (!didCopy) {
      return;
    }

    setCopiedSessionId(sessionId);
    globalThis.setTimeout(() => {
      setCopiedSessionId((current) => (current === sessionId ? null : current));
    }, 1500);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-[360px]">
      <span className="text-fg-3 text-[11px] font-semibold">Thread</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Thread filter"
            className="w-full min-w-0 justify-between px-2 font-normal"
            disabled={disabled}
            size="sm"
            variant="outline"
          >
            <span className="min-w-0 truncate text-[12.5px]" title={selectedLabel}>
              {selectedLabel}
            </span>
            <ChevronDown className="text-fg-3 size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[min(24rem,calc(100vh-8rem))] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto"
        >
          <DropdownMenuItem
            className="justify-between"
            onSelect={() => {
              onChange("");
            }}
          >
            <span>All Threads</span>
            {value === "" ? <Check className="text-accent-press size-3.5" /> : null}
          </DropdownMenuItem>
          {sessions.map((session) => {
            const title = formatThreadTitle(session.title);
            const copied = copiedSessionId === session.id;

            return (
              <div className="flex min-w-0 items-center gap-1" key={session.id}>
                <DropdownMenuItem
                  className="min-w-0 flex-1 py-2"
                  onSelect={() => {
                    onChange(session.id);
                  }}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[12.5px] font-medium" title={title}>
                      {title}
                    </span>
                    <span className="text-fg-3 truncate text-[11px]">
                      {agentNameById.get(session.agentId) ?? "Agent unavailable"}
                    </span>
                  </div>
                  {value === session.id ? <Check className="text-accent-press size-3.5" /> : null}
                </DropdownMenuItem>
                <Button
                  aria-label={copied ? "Thread ID copied" : "Copy Thread ID"}
                  className="text-fg-3 hover:text-fg-1 size-7"
                  onClick={(event) => {
                    void handleCopy(event, session.id);
                  }}
                  size="icon-xs"
                  title={copied ? "Copied" : "Copy Thread ID"}
                  type="button"
                  variant="ghost"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
