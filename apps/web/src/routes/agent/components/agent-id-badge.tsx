import { Check, Copy } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

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

export function AgentIdBadge({
  agentId,
  className,
}: {
  agentId: string;
  className?: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    const didCopy = await writeClipboardText(agentId);
    if (!didCopy) {
      return;
    }

    setCopied(true);
    globalThis.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <div
      className={cn(
        "border-border-subtle text-muted-foreground inline-flex max-w-full items-center gap-1 rounded-md border bg-white py-0.5 pr-0.5 pl-1.5 text-[11px]",
        className,
      )}
    >
      <span title={agentId} className="min-w-0 truncate font-mono">
        ID: {agentId}
      </span>
      <Button
        aria-label={copied ? "Agent ID copied" : "Copy agent ID"}
        className="text-muted-foreground hover:text-foreground size-4"
        onClick={() => {
          void handleCopy();
        }}
        size="icon-xs"
        title={copied ? "Copied" : "Copy agent ID"}
        type="button"
        variant="ghost"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </div>
  );
}
