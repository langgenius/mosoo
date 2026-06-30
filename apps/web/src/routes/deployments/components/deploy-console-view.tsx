import { ExternalLink, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import type { DeployConsoleState } from "../deploy-console-data";
import { DeployOverview } from "./deploy-overview";
import { StatusBadge } from "./deploy-status-badge";
import { DeploymentsHistory } from "./deployments-history";

export interface DeployConsoleViewProps {
  appName: string;
  state: DeployConsoleState;
  deploying: boolean;
  /** Whether a redeploy can be triggered from the console. */
  canDeploy: boolean;
  onRetry: () => void;
  onDelete: () => void;
  /** Render the "Demo data" badge for the fixture-backed preview. */
  demo?: boolean;
}

/**
 * The Deployments console for an App, on a single page: a shared header (App
 * identity, status, live URL, Retry/Delete), the current deployment ledger +
 * bound agents, then the deployment history below. Deploying itself happens via
 * the CLI (`npx mosoo deploy`), not here — the console shows state and offers
 * retry/delete.
 */
export function DeployConsoleView({
  appName,
  state,
  deploying,
  canDeploy,
  onRetry,
  onDelete,
  demo = false,
}: DeployConsoleViewProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { deployment, runs, agents } = state;
  const latestRun = runs[0];

  function confirmDelete() {
    onDelete();
    setConfirmingDelete(false);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 flex-wrap items-start justify-between gap-4 border-b px-8 py-5">
        <div className="min-w-0">
          <div className="text-fg-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
            App · Deployments
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-foreground text-2xl font-semibold tracking-normal">{appName}</h1>
            {deployment === null ? (
              <Badge variant="outline">Not deployed</Badge>
            ) : latestRun ? (
              <StatusBadge status={latestRun.status} />
            ) : null}
            {demo ? <Badge variant="soil">Demo data</Badge> : null}
          </div>
          {deployment === null ? (
            <p className="text-fg-3 mt-1.5 text-[13px]">
              No live Worker. Deploy from your repo with{" "}
              <code className="font-mono">npx mosoo deploy</code>.
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
              <a
                href={deployment.liveUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent-press inline-flex items-center gap-1 font-mono hover:underline"
              >
                {deployment.subdomain}
                <ExternalLink className="size-3" />
              </a>
              <span className="text-fg-3">
                · #{deployment.latestNumber} · commit{" "}
                <span className="font-mono">{deployment.latestCommit}</span> · hosted by Mosoo
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRetry} disabled={deploying || !canDeploy}>
            <RotateCw className={cn("size-3.5", deploying && "animate-spin")} />
            {deploying ? "Deploying…" : "Retry deploy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            disabled={deployment === null}
          >
            <Trash2 className="text-destructive size-3.5" />
            Delete
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
        <div className="mx-auto max-w-5xl">
          <DeployOverview state={state} />

          {deployment === null ? null : (
            <section className="mt-12">
              <h2 className="text-fg-3 mb-3 text-[10.5px] font-semibold tracking-wider uppercase">
                Deployment history
              </h2>
              <DeploymentsHistory
                runs={runs}
                deploying={deploying}
                onRetry={onRetry}
                onDelete={() => setConfirmingDelete(true)}
              />
            </section>
          )}
        </div>
      </main>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this App?</DialogTitle>
            <DialogDescription>
              This removes the App <span className="text-fg-1 font-semibold">{appName}</span>, its
              Cloudflare Worker, and the {agents.length} agent bindings. The public repo is the
              source of truth and is untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              <Trash2 className="size-4" />
              Delete App
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
