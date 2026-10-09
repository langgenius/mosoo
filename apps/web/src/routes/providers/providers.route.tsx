import type { ReactElement } from "react";

import { useActiveProject } from "@/app/session/session-context";

import { ProvidersTab } from "./providers-tab";

export function ProvidersPage(): ReactElement {
  const project = useActiveProject();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ProvidersTab projectId={project.id} />
    </div>
  );
}
