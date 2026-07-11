import { Bot, KeyRound } from "lucide-react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";

import { AppOverviewInstallGuide } from "./app-overview-install";
import { VibeSurface } from "./vibe/vibe-surface";

/**
 * The App Overview at "/": before the first build it is the vibe-app prompt
 * plus the CLI install guide; once the App's web app exists it becomes the
 * vibe console — build status, live preview, publish, source export.
 */
export function AppOverviewPage() {
  const { activeApp, appsLoading } = useAppSession();

  if (activeApp === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? "Loading App…" : "No App available."}
      </div>
    );
  }

  return (
    <VibeSurface
      appId={activeApp.id}
      appName={activeApp.name}
      emptyHero={<AppOverviewInstallGuide />}
      headerActions={
        <>
          <Link
            to="/providers"
            className="border-border hover:bg-muted inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors sm:flex-none"
          >
            <KeyRound className="size-4" />
            Provider keys
          </Link>
          <Link
            to="/agent?create=1"
            className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold shadow-xs transition-colors sm:flex-none"
          >
            <Bot className="size-4" />
            New agent
          </Link>
        </>
      }
    />
  );
}
