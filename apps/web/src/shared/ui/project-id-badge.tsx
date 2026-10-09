import type { MouseEvent, ReactElement } from "react";
import { useState } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { writeClipboardText } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { Check, Copy } from "@/shared/ui/icons";
import { MonoText } from "@/shared/ui/mono-text";

export function ProjectIdBadge({
  className,
  copiedLabel,
  copyLabel,
  label,
  value,
}: {
  className?: string;
  copiedLabel: string;
  copyLabel: string;
  label: string;
  value: string;
}): ReactElement {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy(event: MouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    const didCopy = await writeClipboardText(value);
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
        "border-border-soft text-fg-3 inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-md border bg-card py-0.5 pr-0.5 pl-1.5 text-[11px]",
        className,
      )}
    >
      <MonoText title={value} className="min-w-0 truncate text-[11px]">
        {label} {value}
      </MonoText>
      <Button
        aria-label={copied ? copiedLabel : copyLabel}
        className="text-fg-3 hover:text-foreground size-5"
        onClick={(event) => {
          void handleCopy(event);
        }}
        size="icon-xs"
        title={copied ? t("common.copied") : copyLabel}
        type="button"
        variant="ghost"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </Button>
    </div>
  );
}
