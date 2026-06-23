import { Bot, Box, KeyRound } from "lucide-react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { AppIdBadge } from "@/shared/ui/app-id-badge";

import { AppOverviewInstallGuide } from "./app-overview-install";

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
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 items-center justify-between gap-4 border-b px-8 py-5">
        <div className="min-w-0">
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase">
            <Box className="size-3.5" />
            App
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-foreground min-w-0 truncate text-2xl font-semibold tracking-normal">
              {activeApp.name}
            </h1>
            <AppIdBadge appId={activeApp.id} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/providers"
            className="border-border hover:bg-muted inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors"
          >
            <KeyRound className="size-4" />
            Provider keys
          </Link>
          <Link
            to="/agent?create=1"
            className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold shadow-xs transition-colors"
          >
            <Bot className="size-4" />
            New agent
          </Link>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-10">
        <div className="mx-auto max-w-2xl">
          <AppOverviewInstallGuide />
        </div>
      </main>
    </div>
  );
}
