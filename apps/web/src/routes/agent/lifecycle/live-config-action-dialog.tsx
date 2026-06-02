import type { AgentConfigChangeAction } from "@mosoo/contracts/agent-config-change-plan";
import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

/**
 * Five graphical action levels exposed to operators when they save Live-state
 * config edits. The shared classifier in @mosoo/contracts picks the level based
 * on which fields changed; reset-agent-state is opt-in from Settings Danger zone.
 *
 * The cardinal rule: agent-state stays unless the user is explicitly running
 * Reset. Every dialog says so up top.
 */
export type LifecycleActionKind =
  | Exclude<AgentConfigChangeAction, "direct-update">
  | "reset-agent-state";

interface ActionMeta {
  title: string;
  body: string;
  primary: string;
  preservesState: boolean;
  danger: "low" | "medium" | "high";
}

const META: Record<LifecycleActionKind, ActionMeta> = {
  "patch-and-restart": {
    body: "These edits update the native runtime config (model, skills, env vars). The Agent will restart and reload login state from the same machine — nothing is wiped.",
    danger: "low",
    preservesState: true,
    primary: "Apply now",
    title: "Apply changes · patch native config + restart",
  },
  "recreate-preserving-state": {
    body: "Spaces, network policy, or setup script changed. The container will be rebuilt from a clean image, then your Agent home is restored from the latest backup. Expect ~10–30s of downtime; in-flight sessions reconnect.",
    danger: "medium",
    preservesState: true,
    primary: "Recreate now",
    title: "Apply changes · recreate sandbox (state preserved)",
  },
  "fork-agent": {
    body: "Runtime change is not allowed in-place on a published agent. Fork this agent into a new identity with the new runtime; sessions, cost, audit, and agent-state stay attached to the original.",
    danger: "medium",
    preservesState: true,
    primary: "Fork with new runtime",
    title: "Switching runtime forks a new agent",
  },
  "reset-agent-state": {
    body: "This clears the Agent's runtime home: login tokens, cache, long-term memory, and native session state. Your Agent profile (prompt, skills, MCP refs) is untouched. Cannot be undone.",
    danger: "high",
    preservesState: false,
    primary: "Reset agent-state",
    title: "Reset agent-state · destructive",
  },
  "restart-process": {
    body: "The Agent process will be restarted to pick up the new configuration. Existing live sessions will reconnect automatically.",
    danger: "low",
    preservesState: true,
    primary: "Apply now",
    title: "Apply changes · restart Agent process",
  },
};

export function LiveConfigActionDialog({
  agentName,
  affectedFields,
  busy = false,
  kind,
  onCancel,
  onConfirm,
  open,
}: {
  agentName: string;
  affectedFields: string[];
  busy?: boolean;
  kind: LifecycleActionKind;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
}) {
  const meta = META[kind];
  const requireStrongConfirm = kind === "reset-agent-state";
  const [typed, setTyped] = useState("");

  const canConfirm = !busy && (!requireStrongConfirm || typed.trim() === agentName);
  const forkBlocked = kind === "fork-agent";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTyped("");
          onCancel();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            {meta.danger === "high" ? <AlertTriangle className="text-destructive size-4" /> : null}
            {meta.title}
          </DialogTitle>
          <DialogDescription className="text-fg-2 text-[12.5px] leading-relaxed">
            {meta.body}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <StatePreservationBadge preserves={meta.preservesState} />

          {affectedFields.length > 0 ? (
            <div className="border-border-subtle bg-bg-1 rounded-md border px-3 py-2">
              <div className="text-fg-3 mb-1 text-[11px] font-medium tracking-wide uppercase">
                Fields in this change
              </div>
              <ul className="text-foreground space-y-0.5 text-[12.5px]">
                {affectedFields.map((field) => (
                  <li key={field}>· {field}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {forkBlocked ? (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
              Runtime fork is not yet wired to apply these unsaved changes. To switch runtime,
              create a fork manually and choose the new runtime in the copy.
            </div>
          ) : null}

          {requireStrongConfirm ? (
            <div className="space-y-1.5">
              <div className="text-fg-2 text-[12px]">
                Type <span className="font-mono font-semibold">{agentName}</span> to confirm.
              </div>
              <Input
                onChange={(event) => {
                  setTyped(event.target.value);
                }}
                placeholder={agentName}
                value={typed}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => {
              setTyped("");
              onCancel();
            }}
            size="sm"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            className={cn(
              meta.danger === "high"
                ? "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive"
                : null,
            )}
            disabled={!canConfirm || forkBlocked}
            onClick={() => {
              setTyped("");
              onConfirm();
            }}
            size="sm"
          >
            {busy ? "Working…" : meta.primary}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatePreservationBadge({ preserves }: { preserves: boolean }) {
  if (preserves) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-emerald-50/60 px-3 py-2 text-[12.5px] text-emerald-900">
        <ShieldCheck className="mt-0.5 size-3.5" />
        <span>
          Your <span className="font-mono">agent-state</span> is preserved: login, cache, memory,
          and native sessions stay.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-900">
      <Lock className="mt-0.5 size-3.5" />
      <span>
        This action will clear <span className="font-mono">agent-state</span>: login, cache, memory,
        and native sessions will be lost.
      </span>
    </div>
  );
}
