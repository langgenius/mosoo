import { BookOpen, Check, Code, Copy, ExternalLink, KeyRound } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import type { Agent } from "../agent.types";
import { buildAgentApiCurl, buildAgentDistribution } from "./distribution-info";

type ApiAccessClipboardKey = "agent" | "api" | "docs";

interface AgentApiAccessDialogProps {
  agent: Agent;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

interface AgentApiAccessPanelProps {
  agent: Agent;
}

interface ApiAccessDetailRowProps {
  action: ReactNode;
  label: string;
  value: string;
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (!navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function AgentApiAccessDialog({
  agent,
  onOpenChange,
  open,
}: AgentApiAccessDialogProps): ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="rounded-lg p-0 sm:max-w-[520px]">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="text-[16px]">API Access</DialogTitle>
          <DialogDescription className="mt-0.5 text-[12.5px]">
            Agent ID, token page, and API reference for published access.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-5">
          <AgentApiAccessPanel agent={agent} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AgentApiAccessPanel({ agent }: AgentApiAccessPanelProps): ReactElement {
  const distribution = useMemo(() => buildAgentDistribution(agent), [agent]);
  const curlExample = useMemo(() => buildAgentApiCurl(agent), [agent]);
  const [copiedKey, setCopiedKey] = useState<ApiAccessClipboardKey | null>(null);

  async function copy(text: string, key: ApiAccessClipboardKey) {
    const didCopy = await writeClipboardText(text);
    if (!didCopy) {
      return;
    }

    setCopiedKey(key);
    globalThis.setTimeout(() => {
      setCopiedKey(null);
    }, 1500);
  }

  return (
    <div className="border-border-subtle bg-card rounded-lg border px-3.5 py-3">
      <div className="flex items-start gap-3">
        <Code className="text-fg-3 mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-foreground text-[13px] font-medium">API Access</div>
              <div className="text-fg-2 mt-0.5 truncate font-mono text-[12px]">
                {distribution.apiPath}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                className="gap-1 text-[11.5px]"
                onClick={() => {
                  void copy(curlExample, "api");
                }}
                size="xs"
                variant="outline"
              >
                {copiedKey === "api" ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copiedKey === "api" ? "Copied" : "Copy curl"}
              </Button>
              <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
                <a href={distribution.openApiUrl} rel="noreferrer" target="_blank">
                  <ExternalLink className="size-3" />
                  OpenAPI
                </a>
              </Button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <ApiAccessDetailRow
              action={
                <Button
                  className="gap-1 text-[11.5px]"
                  onClick={() => {
                    void copy(agent.id, "agent");
                  }}
                  size="xs"
                  variant="outline"
                >
                  {copiedKey === "agent" ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  {copiedKey === "agent" ? "Copied" : "Copy"}
                </Button>
              }
              label="Agent ID"
              value={agent.id}
            />
            <ApiAccessDetailRow
              action={
                <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
                  <a href={distribution.tokenSettingsPath}>
                    <KeyRound className="size-3" />
                    Create token
                  </a>
                </Button>
              }
              label="API token"
              value={distribution.tokenSettingsPath}
            />
            <ApiAccessDetailRow
              action={
                <div className="flex gap-1">
                  <Button
                    className="gap-1 text-[11.5px]"
                    onClick={() => {
                      void copy(distribution.apiDocsUrl, "docs");
                    }}
                    size="xs"
                    variant="outline"
                  >
                    {copiedKey === "docs" ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copiedKey === "docs" ? "Copied" : "Copy"}
                  </Button>
                  <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
                    <a href={distribution.apiDocsUrl} rel="noreferrer" target="_blank">
                      <BookOpen className="size-3" />
                      Open
                    </a>
                  </Button>
                </div>
              }
              label="API reference"
              value={distribution.apiDocsUrl}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiAccessDetailRow({ action, label, value }: ApiAccessDetailRowProps): ReactElement {
  return (
    <div className="border-border-subtle bg-bg-1 flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-fg-3 text-[10.5px] font-medium tracking-wide uppercase">{label}</div>
        <div className="text-fg-2 mt-0.5 truncate font-mono text-[12px]">{value}</div>
      </div>
      <div className="flex shrink-0">{action}</div>
    </div>
  );
}
