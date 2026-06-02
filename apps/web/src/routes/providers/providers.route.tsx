import type { ReactElement } from "react";

import { useAppSession } from "../../app/session-provider";
import { ProvidersTab } from "./providers-tab";

export function ProvidersPage(): ReactElement {
  const { activeOrganization: organization, organizationsLoading } = useAppSession();

  if (organization === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {organizationsLoading ? "Loading organization…" : "No organization available."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ProvidersTab organization={organization} />
    </div>
  );
}
