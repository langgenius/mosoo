import { ExternalLink, Rocket } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { CommandBlock } from "@/shared/ui/command-block";

import type { DeployConsoleState } from "../deploy-console-data";
import { BoundAgents } from "./bound-agents";
import { StatusBadge } from "./deploy-status-badge";

function LedgerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border-soft grid grid-cols-[180px_1fr] items-center gap-4 border-b py-2.5 last:border-b-0">
      <dt className="text-fg-3 text-[12.5px]">{label}</dt>
      <dd className="text-fg-1 min-w-0 text-[13px]">{children}</dd>
    </div>
  );
}

const HATCH_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--bg-sunken) 0, var(--bg-sunken) 10px, transparent 10px, transparent 20px)",
};

export function DeployOverview({ state }: { state: DeployConsoleState }) {
  const { deployment, runs, agents } = state;

  if (deployment === null) {
    return (
      <div className="border-border bg-bg-sunken flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
        <Rocket className="text-fg-3 size-6" />
        <div className="text-fg-1 text-sm font-semibold">Not deployed yet</div>
        <p className="text-fg-3 max-w-sm text-[13px] leading-relaxed">
          Deploy from your public repo with the Mosoo CLI — Mosoo pulls your default branch HEAD and
          binds your Agents. Status shows up here once it’s live.
        </p>
        <CommandBlock className="w-full max-w-xs" command="npx mosoo deploy" />
      </div>
    );
  }

  const latestRun = runs[0];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <div
          className="border-border text-fg-3 flex h-32 items-center justify-center rounded-lg border text-[12.5px]"
          style={HATCH_STYLE}
        >
          <span className="bg-background rounded-md px-2.5 py-1 font-mono">
            live · {deployment.subdomain}
          </span>
        </div>

        <div className="text-fg-3 mt-5 mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
          App ledger
        </div>
        <dl className="border-border bg-background rounded-lg border px-4 py-1">
          <LedgerRow label="app name">
            <span className="font-semibold">{deployment.appName}</span>
          </LedgerRow>
          <LedgerRow label="repo (source of truth)">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono text-[12.5px]">{deployment.repoUrl}</span>
              <span className="text-success-fg bg-success-bg rounded-sm px-1.5 py-0.5 text-[11px] font-bold">
                public
              </span>
            </span>
          </LedgerRow>
          <LedgerRow label="commit">
            <span className="font-mono">{deployment.latestCommit}</span>
            <span className="text-fg-3"> · default branch HEAD</span>
          </LedgerRow>
          <LedgerRow label="url">
            <a
              href={deployment.liveUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent-press inline-flex items-center gap-1 font-mono text-[12.5px] hover:underline"
            >
              {deployment.subdomain}
              <ExternalLink className="size-3" />
            </a>
          </LedgerRow>
          <LedgerRow label="status">
            <span className="inline-flex items-center gap-2">
              {latestRun ? <StatusBadge status={latestRun.status} /> : null}
              <span className="text-fg-3 text-[12.5px]">#{deployment.latestNumber}</span>
            </span>
          </LedgerRow>
          <LedgerRow label="agents">
            <span>
              {agents.map((agent) => agent.name).join(" · ")}{" "}
              <span className="text-fg-3">({agents.length})</span>
            </span>
          </LedgerRow>
        </dl>
      </div>

      <BoundAgents agents={agents} />
    </div>
  );
}
