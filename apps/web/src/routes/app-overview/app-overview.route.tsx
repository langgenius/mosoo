import { useAppSession } from "@/app/session-provider";

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

  return <VibeSurface appId={activeApp.id} appName={activeApp.name} />;
}
