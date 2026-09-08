import { lazy, Suspense, useEffect, useState } from "react";

import { useTranslation } from "@/shared/i18n";
import { HelpCircle } from "@/shared/ui/icons";
import { SidebarRow } from "@/shared/ui/sidebar";

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
  const { t } = useTranslation();
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

  return (
    <>
      <SidebarRow
        collapsed={collapsed}
        icon={HelpCircle}
        label={t("help.helpAndDocs")}
        onClick={() => {
          openHelp();
        }}
      />
      {hasOpened ? (
        <Suspense fallback={null}>
          <HelpDocsDialog open={open} onOpenChange={handleOpenChange} />
        </Suspense>
      ) : null}
    </>
  );
}
