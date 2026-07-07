import { Bot, Check, Code2, Copy, ExternalLink, GitBranch, KeyRound, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";

import { DEPLOY_TARGET_LABELS } from "../deploy-console-data";
import type {
  BoundAgentVM,
  DeploymentRunVM,
  DeploymentVM,
  NativeRunVM,
} from "../deploy-console-data";
import {
  appNamespaceAgentCurl,
  appNamespaceAgentPath,
  appNamespaceBasePath,
  consoleOrigin,
  hostOf,
} from "../deploy-console-mapping";
import type { LocalDeploymentPreviewState } from "../local-preview-url";
import { RepoDeployForm } from "./deploy-repo-card";
import { DeployUrlCard } from "./deploy-url-card";
import type { DeployNamespaceInfo } from "./deploy-url-card";

const ACCESS_TOKEN_SETTINGS_PATH = "/settings/access-tokens";

/**
 * One exposed agent's name-addressed API surface, flattened for the Connect
 * card. `agentId` is best-effort — it resolves only when the exposed agent is
 * also a web-bound agent (native run facts carry names, not ULIDs), and gates
 * the in-console playground link; the curl is always name-addressed.
 */
interface ExposedAgentSurface {
  agentId: string | null;
  curl: string;
  name: string;
  path: string;
  versionNumber: number | undefined;
}

/**
 * Exposed agents of the latest run (`native.agents` where `exposed`), mapped to
 * their name-addressed `/api/v1/apps/{slug}/agents/{name}/threads` surfaces.
 */
function toExposedAgentSurfaces(
  slug: string,
  native: NativeRunVM | null,
  boundAgents: BoundAgentVM[],
): ExposedAgentSurface[] {
  const origin = consoleOrigin();
  const idByName = new Map(boundAgents.map((agent) => [agent.name, agent.id]));

  return (native?.agents ?? [])
    .filter((agent) => agent.exposed)
    .map((agent) => ({
      agentId: idByName.get(agent.name) ?? null,
      curl: appNamespaceAgentCurl(origin, slug, agent.name),
      name: agent.name,
      path: `POST ${appNamespaceAgentPath(slug, agent.name)}`,
      versionNumber: agent.versionNumber,
    }));
}

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      className="gap-1 text-[11.5px]"
      aria-label={label}
      onClick={() => {
        if (!navigator.clipboard) {
          return;
        }
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          globalThis.setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function TryLink({ agentId, name }: { agentId: string; name: string }) {
  return (
    <Button asChild size="xs" variant="ghost" className="gap-1 text-[11.5px]">
      <Link to={`/agent/${agentId}?tab=consume`} aria-label={`Open ${name} in the playground`}>
        <Play className="size-3" />
        Try
      </Link>
    </Button>
  );
}

function CurlBlock({ curl, label }: { curl: string; label: string }) {
  return (
    <div className="border-border bg-bg-sunken/60 relative rounded-lg border">
      <pre className="text-fg-2 overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">
        <code>{curl}</code>
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton label={label} text={curl} />
      </div>
    </div>
  );
}

/**
 * Per-agent name-addressed surfaces as a table — shown when more than one agent
 * is exposed. No 24h-usage column: that aggregation is deferred, so the table
 * carries only columns it can fill (name · endpoint · live version · curl/Try).
 */
function AgentSurfaceTable({ surfaces }: { surfaces: ExposedAgentSurface[] }) {
  return (
    <div data-testid="deploy-agent-surface-table" className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr className="text-fg-3 text-[11px] font-medium tracking-wide uppercase">
            <th className="py-1.5 pr-3 font-medium">Agent</th>
            <th className="py-1.5 pr-3 font-medium">Endpoint</th>
            <th className="py-1.5 pr-3 font-medium">Live version</th>
            <th className="py-1.5 font-medium">curl / Try</th>
          </tr>
        </thead>
        <tbody>
          {surfaces.map((surface) => (
            <tr
              key={surface.name}
              data-testid="deploy-agent-surface-row"
              className="border-border/60 border-t align-middle"
            >
              <td className="text-fg-1 py-2 pr-3 font-mono text-[12.5px]">{surface.name}</td>
              <td className="text-fg-2 py-2 pr-3 font-mono text-[11.5px]">{surface.path}</td>
              <td className="text-fg-3 py-2 pr-3 font-mono text-[12px]">
                {surface.versionNumber === undefined ? "—" : `v${String(surface.versionNumber)}`}
              </td>
              <td className="py-2">
                <div className="flex flex-wrap items-center gap-1">
                  <CopyButton label={`Copy curl for ${surface.name}`} text={surface.curl} />
                  {surface.agentId === null ? null : (
                    <TryLink agentId={surface.agentId} name={surface.name} />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * S1 API species: the name-addressed Connect surface for a slugged App. Renders
 * the namespace base path, an access-token pointer, and each exposed agent's
 * POST path + curl (a single agent inline, several as a surface table). Never
 * shows an agent ULID — every coordinate is name-addressed off the App slug.
 */
function ConnectCard({
  bothMode,
  slug,
  surfaces,
}: {
  bothMode: boolean;
  slug: string;
  surfaces: ExposedAgentSurface[];
}) {
  const baseDisplay = `${hostOf(consoleOrigin())}${appNamespaceBasePath(slug)}`;
  // A worked curl for the first exposed agent anchors the card; the full roster
  // becomes a surface table once more than one agent is exposed.
  const primary = surfaces[0];

  return (
    <div
      data-testid="deploy-connect-card"
      className="border-border bg-background mt-10 flex flex-col gap-4 rounded-xl border px-5 py-4"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="text-fg-1 flex items-center gap-1.5 text-[14px] font-semibold">
          <Code2 className="text-fg-3 size-4" />
          Connect
        </div>
        {bothMode ? (
          <Badge variant="outline">web + agent api</Badge>
        ) : (
          <Badge variant="outline">agent api</Badge>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-fg-3 text-[12px]">Namespace base</span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="text-fg-2 min-w-0 truncate font-mono text-[12.5px]">{baseDisplay}</code>
          <CopyButton label="Copy namespace base path" text={baseDisplay} />
        </div>
      </div>

      <div className="text-fg-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px]">
        <KeyRound className="size-3.5" />
        <span>Authenticate with a</span>
        <Link
          to={ACCESS_TOKEN_SETTINGS_PATH}
          className="text-accent-press font-medium hover:underline"
        >
          personal access token
        </Link>
        <span>· send it as a Bearer token.</span>
      </div>

      {primary === undefined ? null : (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <code className="text-fg-2 min-w-0 truncate font-mono text-[12px]">{primary.path}</code>
            {primary.versionNumber === undefined ? null : (
              <span className="text-fg-3 font-mono text-[12px]">
                v{String(primary.versionNumber)}
              </span>
            )}
            {primary.agentId === null ? null : (
              <TryLink agentId={primary.agentId} name={primary.name} />
            )}
          </div>
          <CurlBlock curl={primary.curl} label={`Copy curl for ${primary.name}`} />
        </div>
      )}

      {surfaces.length > 1 ? <AgentSurfaceTable surfaces={surfaces} /> : null}
    </div>
  );
}

function previewUnavailableLabel(
  deployment: DeploymentVM,
  live: boolean,
  localPreview: LocalDeploymentPreviewState,
): string {
  if (localPreview.status === "checking") {
    return "Checking development preview";
  }
  if (localPreview.status === "offline") {
    return "Development preview offline";
  }
  if (live && deployment.liveUrl !== null) {
    return hostOf(deployment.liveUrl);
  }
  return "Preview unavailable";
}

function PreviewFrame({
  deployment,
  latestRun,
  localPreview,
}: {
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
  localPreview: LocalDeploymentPreviewState;
}) {
  const live = deployment.liveUrl !== null && latestRun?.status === "success";
  const localPreviewReady = localPreview.url !== null && localPreview.status === "online";
  const previewLinkUrl = localPreviewReady ? localPreview.url : live ? deployment.liveUrl : null;
  const previewLabel =
    localPreviewReady && localPreview.url !== null
      ? hostOf(localPreview.url)
      : previewUnavailableLabel(deployment, live, localPreview);

  return (
    <div className="border-border bg-bg-sunken/60 rounded-xl border p-1.5 lg:h-[var(--deploy-preview-height)]">
      <div className="border-border/60 bg-background relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-lg border lg:aspect-auto lg:h-full">
        {previewLinkUrl !== null ? (
          <>
            <iframe
              title={`${deployment.appName} deployment preview`}
              src={previewLinkUrl}
              className="bg-background pointer-events-none absolute top-0 left-0 h-[142.86%] w-[142.86%] origin-top-left scale-[0.7] border-0"
              sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts"
              scrolling="no"
              referrerPolicy="no-referrer"
            />
            <a
              href={previewLinkUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open deployment preview"
              className="group focus-visible:ring-ring absolute inset-0 cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <span className="border-border/80 bg-background/92 text-fg-2 group-hover:text-fg-1 group-hover:border-accent absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-md border opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100 group-focus-visible:opacity-100">
                <ExternalLink className="size-3.5" />
              </span>
            </a>
          </>
        ) : (
          <div className="flex min-w-0 flex-col items-center gap-1.5 px-4 text-center">
            <span className="border-border text-fg-2 rounded-md border px-3 py-1.5 text-[12.5px] font-medium">
              {previewLabel}
            </span>
            {localPreview.url === null ? null : (
              <a
                href={localPreview.url}
                target="_blank"
                rel="noreferrer"
                className="text-fg-3 hover:text-fg-2 inline-flex max-w-full items-center gap-1.5 font-mono text-[11.5px] transition-colors"
              >
                <span className="truncate">{hostOf(localPreview.url)}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Badge tint per provisioning action; only a failed upsert reads as red. */
const AGENT_ACTION_BADGE_VARIANTS: Record<
  NativeRunVM["agents"][number]["action"],
  "danger" | "outline" | "success"
> = {
  created: "success",
  failed: "danger",
  unchanged: "outline",
  updated: "success",
};

/**
 * S1 hero for agent-only deploys: there is no web preview to frame, so the
 * protagonist is the roster of deployed agents with each one's provisioning
 * outcome from the latest run's native facts.
 */
function DeployedAgentsCard({ native }: { native: NativeRunVM | null }) {
  const agents = native?.agents ?? [];

  return (
    <div
      data-testid="deploy-agents-card"
      className="border-border bg-bg-sunken/60 rounded-xl border p-1.5 lg:h-[var(--deploy-preview-height)]"
    >
      <div className="border-border/60 bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-lg border px-5 py-4">
        <div className="text-fg-3 text-[13px]">Deployed agents</div>
        {agents.length === 0 ? (
          <p className="text-fg-3 mt-3 text-[12.5px]">No agent facts recorded for this run.</p>
        ) : (
          <ul className="mt-3 flex min-h-0 flex-col gap-2 overflow-y-auto">
            {agents.map((agent) => (
              <li key={agent.name} className="flex min-w-0 items-center gap-2">
                <Bot className="text-fg-3 size-3.5 shrink-0" />
                <span className="text-fg-1 min-w-0 truncate font-mono text-[13px]">
                  {agent.name}
                </span>
                <Badge variant={AGENT_ACTION_BADGE_VARIANTS[agent.action]}>{agent.action}</Badge>
                {agent.versionNumber === undefined ? null : (
                  <span className="text-fg-3 font-mono text-[12px]">
                    v{String(agent.versionNumber)}
                  </span>
                )}
              </li>
            ))}
          </ul>
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
          <Code2 className="text-fg-3 size-3.5 shrink-0" />
          <span className="truncate">{deployment.repoUrl}</span>
          <ExternalLink className="text-fg-3 size-3.5 shrink-0" />
        </a>
        <Badge variant="success">public</Badge>
      </div>
      <div className="text-fg-3 flex flex-wrap items-center gap-x-1.5 text-[13px]">
        <GitBranch className="size-3.5" />
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
 * The deployed-state hero: the preview frame (or, for agent-only deploys, the
 * deployed-agents roster) is the protagonist on the left; the right column is
 * an unboxed typographic stack — Domain and Source separated by hairlines, no
 * card chrome.
 */
export function DeployOverview({
  agents,
  deployment,
  latestRun,
  localPreview,
  deploying,
  deployError,
  onDeployRepo,
}: {
  /** Web-bound agents of the App; used to resolve exposed-agent playground links by name. */
  agents: BoundAgentVM[];
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
  localPreview: LocalDeploymentPreviewState;
  deploying: boolean;
  deployError: string | null;
  onDeployRepo: (repoUrl: string) => void;
}) {
  const { slug } = deployment;
  const surfaces =
    slug === null ? [] : toExposedAgentSurfaces(slug, latestRun?.native ?? null, agents);
  const hasApi = surfaces.length > 0 && slug !== null;
  // `webDeclared` is what separates a both-mode protocol deploy (serves a web
  // app AND an agent API) from an agent-only one; a legacy web run has no
  // native facts and exposes no API at all.
  const hasWeb = latestRun?.native?.webDeclared === true;

  const primary = surfaces[0];
  const playgroundHref =
    primary !== undefined && primary.agentId !== null
      ? `/agent/${primary.agentId}?tab=consume`
      : "/agent";
  const namespace: DeployNamespaceInfo | null =
    hasApi && slug !== null
      ? { baseDisplay: `${hostOf(consoleOrigin())}${appNamespaceBasePath(slug)}`, playgroundHref }
      : null;

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:[--deploy-preview-height:clamp(190px,22vw,300px)]">
        {latestRun !== undefined && latestRun.targetKind === "agent_only" ? (
          <DeployedAgentsCard native={latestRun.native} />
        ) : (
          <PreviewFrame deployment={deployment} latestRun={latestRun} localPreview={localPreview} />
        )}

        <div className="flex min-w-0 flex-col gap-5 lg:pt-1">
          <DeployUrlCard
            deployment={deployment}
            latestRun={latestRun}
            localPreview={localPreview}
            namespace={namespace}
          />
          <Separator />
          <SourceGroup
            deployment={deployment}
            latestRun={latestRun}
            deploying={deploying}
            deployError={deployError}
            onDeployRepo={onDeployRepo}
          />
        </div>
      </div>

      {hasApi && slug !== null ? (
        <ConnectCard bothMode={hasWeb} slug={slug} surfaces={surfaces} />
      ) : null}
    </>
  );
}
