import { Check, Copy } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

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

export function AppIdBadge({
  appId,
  className,
}: {
  appId: string;
  className?: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const didCopy = await writeClipboardText(appId);
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
        "border-border-subtle text-muted-foreground inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-md border bg-white py-0.5 pr-0.5 pl-1.5 text-[11px]",
        className,
      )}
    >
      <span title={appId} className="min-w-0 truncate font-mono">
        App ID: {appId}
      </span>
      <Button
        aria-label={copied ? "App ID copied" : "Copy app ID"}
        className="text-muted-foreground hover:text-foreground size-5"
        onClick={(event) => {
          void handleCopy(event);
        }}
        size="icon-xs"
        title={copied ? "Copied" : "Copy app ID"}
        type="button"
        variant="ghost"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </div>
  );
}
