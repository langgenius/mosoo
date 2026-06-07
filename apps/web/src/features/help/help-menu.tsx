import { HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { HelpDocsDialog } from "./help-docs-dialog";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function HelpMenu({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);

  // Press "?" anywhere outside a text field to open help, matching the common
  // shortcut used by other apps.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setOpen(true);
    }

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const button = (
    <button
      type="button"
      onClick={() => {
        setOpen(true);
      }}
      aria-label="Help & docs"
      className={cn(
        "text-fg-2 hover:bg-ink-900/[0.04] hover:text-fg-1 flex items-center rounded-md text-[13.5px] font-semibold transition-colors",
        collapsed ? "size-9 justify-center self-center" : "w-full gap-2.5 px-2.5 py-2",
      )}
    >
      <HelpCircle className="size-4" />
      {collapsed ? null : <span>Help &amp; docs</span>}
    </button>
  );

  return (
    <>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right">Help &amp; docs</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <HelpDocsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
