import { GitBranch } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";

import type { Agent } from "../agent.types";
import { getRuntimeInfo } from "../runtime-catalog";
import { RuntimeIcon } from "./runtime-icon";

function formatVersionTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

export function VersionsTab({ agent }: { agent: Agent }): ReactElement {
  const runtime = getRuntimeInfo(agent.runtime);

  return (
    <div className="bg-paper-200 flex h-full flex-col">
      <header className="border-border-subtle shrink-0 border-b bg-white px-5 py-4 pr-12">
        <div className="flex items-center gap-3">
          <div className="border-border flex size-8 items-center justify-center rounded-lg border bg-white">
            <GitBranch className="text-muted-foreground size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-foreground text-[14px] font-medium">Versions</div>
            <div className="text-muted-foreground mt-0.5 text-[12px]">
              New sessions use the live version. Existing sessions keep their pinned execution
              binding.
            </div>
          </div>
          <div className="flex-1" />
          {agent.liveVersion ? (
            <Badge variant="success" className="h-5 text-[11px]">
              v{agent.liveVersion.versionNumber} live
            </Badge>
          ) : (
            <Badge variant="outline" className="h-5 text-[11px]">
              No live version
            </Badge>
          )}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl p-5">
          {agent.versions.length === 0 ? (
            <div className="border-border rounded-lg border border-dashed bg-white px-5 py-8 text-center">
              <div className="text-foreground text-[14px] font-medium">No published versions.</div>
              <div className="text-muted-foreground mt-1 text-[12px]">
                Publish this Agent to create its first live DeploymentVersion.
              </div>
            </div>
          ) : (
            <div className="border-border overflow-hidden rounded-lg border bg-white">
              {agent.versions.map((version, index) => (
                <div
                  className="border-border-subtle grid grid-cols-[96px_minmax(0,1fr)_180px] items-center gap-4 border-b px-4 py-3 last:border-b-0"
                  key={version.id}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-[13px] font-medium">
                      v{version.versionNumber}
                    </span>
                    {version.isLive ? (
                      <Badge variant="success" className="h-4 text-[10px]">
                        live
                      </Badge>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    <div className="text-foreground truncate text-[13px] font-medium">
                      {version.summary}
                    </div>
                    <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 text-[11px]">
                      <RuntimeIcon runtime={runtime} size={14} />
                      <span className="truncate">{version.runtimeId}</span>
                      <span>·</span>
                      <span className="truncate">{version.model}</span>
                    </div>
                  </div>

                  <div className="text-muted-foreground text-right text-[11px]">
                    {formatVersionTime(version.createdAt)}
                    {index === 0 && !version.isLive ? (
                      <div className="text-muted-foreground mt-1 text-[10.5px]">
                        Historical version
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
