import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";

import { DEPLOY_TARGET_LABELS } from "../deploy-console-data";
import type { BoundAgentVM, DeploymentRunVM, DeploymentVM } from "../deploy-console-data";
import { hostOf } from "../deploy-console-mapping";
import { BoundAgents } from "./bound-agents";
import { RepoDeployForm } from "./deploy-repo-card";
import { DeployUrlCard } from "./deploy-url-card";

function PreviewFrame({
  deployment,
  latestRun,
}: {
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
}) {
  const live = deployment.liveUrl !== null && latestRun?.status === "success";

  return (
    <div className="border-border bg-bg-sunken/60 rounded-2xl border p-1.5">
      <div className="border-border/60 bg-background flex aspect-[16/10] items-center justify-center rounded-xl border">
        {live && deployment.liveUrl !== null ? (
          <a
            href={deployment.liveUrl}
            target="_blank"
            rel="noreferrer"
            className="border-border text-fg-2 hover:text-fg-1 hover:border-accent inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 font-mono text-[12.5px] transition-colors"
          >
            {hostOf(deployment.liveUrl)}
            <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="border-border text-fg-3 rounded-lg border px-3.5 py-1.5 text-[12.5px]">
            Preview unavailable
          </span>
        )}
      </div>
    </div>
  );
}

function SourceGroup({
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
    <div className="flex flex-col gap-2">
      <div className="text-fg-3 text-[13px]">Source</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <a
          href={`https://${deployment.repoUrl}`}
          target="_blank"
          rel="noreferrer"
          className="text-fg-1 hover:text-accent-press inline-flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold transition-colors hover:underline"
        >
          <span className="truncate">{deployment.repoUrl}</span>
          <ExternalLink className="text-fg-3 size-3.5 shrink-0" />
        </a>
        <Badge variant="success">public</Badge>
      </div>
      <div className="text-fg-3 flex flex-wrap items-center gap-x-1.5 text-[13px]">
        <span>
          branch <span className="text-fg-2 font-mono">{deployment.defaultBranch}</span>
        </span>
        {latestRun === undefined ? null : (
          <span>
            · HEAD <span className="text-fg-2 font-mono">{latestRun.commitSha}</span>
          </span>
        )}
        {latestRun === undefined || latestRun.targetKind === null ? null : (
          <Badge variant="outline">{DEPLOY_TARGET_LABELS[latestRun.targetKind]}</Badge>
        )}
      </div>
      {changingRepo ? (
        <div className="mt-1">
          <RepoDeployForm deploying={deploying} serverError={deployError} onDeploy={onDeployRepo} />
          <Button variant="ghost" size="xs" className="mt-1" onClick={() => setChangingRepo(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setChangingRepo(true)}
          className="text-accent-press w-fit cursor-pointer text-[13px] font-medium hover:underline"
        >
          Change repo…
        </button>
      )}
    </div>
  );
}

/**
 * The deployed-state hero: the preview frame is the protagonist on the left;
 * the right column is an unboxed typographic stack — Domain, Source, and
 * bound agents separated by hairlines, no card chrome.
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
    <div className="grid grid-cols-1 items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
      <PreviewFrame deployment={deployment} latestRun={latestRun} />

      <div className="flex min-w-0 flex-col gap-5 lg:pt-1">
        <DeployUrlCard deployment={deployment} latestRun={latestRun} />
        <Separator />
        <SourceGroup
          deployment={deployment}
          latestRun={latestRun}
          deploying={deploying}
          deployError={deployError}
          onDeployRepo={onDeployRepo}
        />
        <Separator />
        <BoundAgents agents={agents} />
      </div>
    </div>
  );
}
