import type { ReactElement } from "react";

import { useAppSession } from "../../app/session-provider";
import { ProvidersTab } from "./providers-tab";

export function ProvidersPage(): ReactElement {
  const { activeAppId, appsLoading } = useAppSession();

  if (activeAppId === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? "Loading App…" : "No App available."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ProvidersTab appId={activeAppId} />
    </div>
  );
}
