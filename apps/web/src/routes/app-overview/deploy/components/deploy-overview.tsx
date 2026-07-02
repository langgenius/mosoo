import { ExternalLink } from "lucide-react";
import type { CSSProperties } from "react";
import { useState } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { DEPLOY_TARGET_LABELS } from "../deploy-console-data";
import type { BoundAgentVM, DeploymentRunVM, DeploymentVM } from "../deploy-console-data";
import { hostOf } from "../deploy-console-mapping";
import { BoundAgents } from "./bound-agents";
import { RepoDeployForm } from "./deploy-repo-card";
import { DeployUrlCard } from "./deploy-url-card";

const HATCH_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--bg-sunken) 0, var(--bg-sunken) 10px, transparent 10px, transparent 20px)",
};

function SourceCard({
  deployment,
  latestRun,
  deploying,
  deployError,
  onDeployRepo,
}: {
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
  deploying: boolean;
  deployError: string | null;
  onDeployRepo: (repoUrl: string) => void;
}) {
  const [changingRepo, setChangingRepo] = useState(false);

  return (
    <div className="border-border bg-background rounded-lg border px-4 py-3.5">
      <div className="text-fg-3 mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
        Source
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <a
            href={`https://${deployment.repoUrl}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent-press inline-flex min-w-0 items-center gap-1 font-mono text-[12.5px] hover:underline"
          >
            <span className="truncate">{deployment.repoUrl}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
          <Badge variant="success">public</Badge>
        </div>
        <div className="text-fg-3 text-[12.5px]">
          branch <span className="text-fg-2 font-mono">{deployment.defaultBranch}</span>
          {latestRun === undefined ? null : (
            <>
              {" "}
              · HEAD <span className="text-fg-2 font-mono">{latestRun.commitSha}</span>
            </>
          )}
          {latestRun === undefined || latestRun.targetKind === null ? null : (
            <>
              {" "}
              <Badge variant="outline">{DEPLOY_TARGET_LABELS[latestRun.targetKind]}</Badge>
            </>
          )}
        </div>
        {changingRepo ? (
          <div className="mt-2">
            <RepoDeployForm
              deploying={deploying}
              serverError={deployError}
              onDeploy={onDeployRepo}
            />
            <Button
              variant="ghost"
              size="xs"
              className="mt-1"
              onClick={() => setChangingRepo(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="ghost" size="xs" onClick={() => setChangingRepo(true)}>
              Change repo…
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The deployed-state Overview body: the hatch preview on the left, then the
 * URL, Source, and bound-agent cards stacked on the right.
 */
export function DeployOverview({
  deployment,
  latestRun,
  agents,
  deploying,
  deployError,
  onDeployRepo,
}: {
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
  agents: BoundAgentVM[];
  deploying: boolean;
  deployError: string | null;
  onDeployRepo: (repoUrl: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div
        className="border-border text-fg-3 flex min-h-48 items-center justify-center rounded-lg border text-[12.5px]"
        style={HATCH_STYLE}
      >
        <span className="bg-background rounded-md px-2.5 py-1 font-mono">
          {deployment.liveUrl === null
            ? deployment.appName
            : `live · ${hostOf(deployment.liveUrl)}`}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <DeployUrlCard deployment={deployment} latestRun={latestRun} />
        <SourceCard
          deployment={deployment}
          latestRun={latestRun}
          deploying={deploying}
          deployError={deployError}
          onDeployRepo={onDeployRepo}
        />
        <BoundAgents agents={agents} />
      </div>
    </div>
  );
}
