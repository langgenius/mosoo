import type { ReactElement } from "react";

import { Markdown } from "@/shared/ui/markdown";

export function AgentBuilderStreamingText({ text }: { text: string }): ReactElement {
  if (text.length === 0) {
    return <BuilderStreamCaret />;
  }

  return (
    <Markdown className="mt-1.5 space-y-2 text-[12px] leading-relaxed break-words">{text}</Markdown>
  );
}

export function BuilderStreamCaret(): ReactElement {
  return (
    <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-[12px]">
      <span className="bg-muted-foreground/70 inline-block size-1.5 animate-pulse rounded-full" />
      <span className="bg-muted-foreground/50 inline-block size-1.5 animate-pulse rounded-full [animation-delay:120ms]" />
      <span className="bg-muted-foreground/30 inline-block size-1.5 animate-pulse rounded-full [animation-delay:240ms]" />
    </div>
  );
}
