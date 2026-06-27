import { Check, Copy } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";

async function writeClipboardText(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

// A copyable terminal command / code line. The leading prompt (default "$") is
// decorative and never copied — only `command` lands on the clipboard.
export function CommandBlock({
  className,
  command,
  copyLabel = "Copy command",
  prompt = "$",
}: {
  className?: string;
  command: string;
  copyLabel?: string;
  prompt?: string | null;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  function copy() {
    void writeClipboardText(command).then((didCopy) => {
      if (!didCopy) {
        return;
      }

      setCopied(true);
      globalThis.setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  }

  return (
    <div
      className={cn(
        "border-border bg-bg-sunken flex items-center gap-3 rounded-md border px-3 py-2.5",
        className,
      )}
    >
      <code className="text-fg-1 min-w-0 flex-1 truncate font-mono text-[13px]">
        {prompt === null ? null : <span className="text-fg-3 select-none">{prompt} </span>}
        {command}
      </code>
      <button
        type="button"
        aria-label={copied ? "Copied" : copyLabel}
        onClick={copy}
        className="text-fg-3 hover:bg-ink-900/[0.06] hover:text-fg-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        {copied ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
