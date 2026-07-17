import { HelpCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

// Loaded on demand the first time Help is opened. The dialog drags in the Radix
// dialog primitive and the help-docs search index, none of which the app shell
// needs for its initial render, so it stays out of the entry bundle that loads
// on every page.
const HelpDocsDialog = lazy(async () => {
  const helpDocsDialog = await import("./help-docs-dialog");
  return { default: helpDocsDialog.HelpDocsDialog };
});

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function HelpMenu({
  collapsed,
  shortcutEnabled = true,
}: {
  collapsed: boolean;
  shortcutEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Keep the dialog mounted once it has been opened so its close animation can
  // still play, but never mount it before the first open so the chunk is not
  // fetched on a normal page load.
  const [hasOpened, setHasOpened] = useState(false);

  function openHelp(): void {
    setHasOpened(true);
    setOpen(true);
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (nextOpen) {
      setHasOpened(true);
    }
    setOpen(nextOpen);
  }

  // Press "?" anywhere outside a text field to open help, matching the common
  // shortcut used by other apps.
  useEffect(() => {
    if (!shortcutEnabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }

      event.preventDefault();
      openHelp();
    }

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcutEnabled]);

  const button = (
    <button
      type="button"
      onClick={() => {
        openHelp();
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
      {hasOpened ? (
        <Suspense fallback={null}>
          <HelpDocsDialog open={open} onOpenChange={handleOpenChange} />
        </Suspense>
      ) : null}
    </>
  );
}
