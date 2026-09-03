import type { MouseEvent, ReactElement } from "react";
import { useState } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { writeClipboardText } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { Check, Copy } from "@/shared/ui/icons";

export function ProjectIdBadge({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const didCopy = await writeClipboardText(projectId);
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
      <span title={projectId} className="min-w-0 truncate font-mono">
        {t("agent.projectId")}: {projectId}
      </span>
      <Button
        aria-label={copied ? t("agent.projectIdCopied") : t("agent.copyProjectId")}
        className="text-muted-foreground hover:text-foreground size-5"
        onClick={(event) => {
          void handleCopy(event);
        }}
        size="icon-xs"
        title={copied ? t("common.copied") : t("agent.copyProjectId")}
        type="button"
        variant="ghost"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </div>
  );
}
