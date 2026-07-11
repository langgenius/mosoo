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
  stateNotice: string;
  danger: "low" | "medium" | "high";
}

const META: Record<LifecycleActionKind, ActionMeta> = {
  "patch-and-restart": {
    body: "These edits update the native runtime config (model, skills, env vars). The Agent will restart and reload login state from the same machine. Nothing is wiped.",
    danger: "low",
    preservesState: true,
    primary: "Apply now",
    stateNotice: "The current Sandbox is reused, so its runtime-local state remains in place.",
    title: "Apply changes · patch native config + restart",
  },
  "recreate-preserving-state": {
    body: "The setup output or saved network-policy intent changed. The container will be rebuilt from a clean image. Only checkpoint-covered memory and eligible Session workspaces are restored; saved network policy is not currently enforced. Expect ~10-30s of downtime.",
    danger: "medium",
    preservesState: true,
    primary: "Recreate now",
    stateNotice:
      "Checkpoint-covered memory and eligible Session workspaces are restored. Login, cache, and other home paths are not guaranteed.",
    title: "Apply changes · recreate sandbox (checkpointed paths restored)",
  },
  "fork-agent": {
    body: "Runtime changes are not allowed in-place after publishing. Fork this Agent with the new runtime; sessions, cost, and agent-state stay attached to the original.",
    danger: "medium",
    preservesState: true,
    primary: "Fork with new runtime",
    stateNotice: "Sessions, cost, and runtime state remain attached to the original Agent.",
    title: "Switching runtime forks a new agent",
  },
  "reset-agent-state": {
    body: "This destroys the current Pet Sandbox after clearing long-term memory and Session runtime directories; login and cache disappear with the container. Stored native resume references are not currently removed. Your Agent profile is untouched. Cannot be undone.",
    danger: "high",
    preservesState: false,
    primary: "Reset agent-state",
    stateNotice:
      "Sandbox-local login/cache, checkpointed memory, and Session runtime directories are cleared. Stored native resume references may remain.",
    title: "Reset agent-state · destructive",
  },
  "restart-process": {
    body: "The Agent process will be restarted to pick up the new configuration. Existing live sessions will reconnect automatically.",
    danger: "low",
    preservesState: true,
    primary: "Apply now",
    stateNotice: "The current Sandbox is reused, so its runtime-local state remains in place.",
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
          <StatePreservationBadge message={meta.stateNotice} preserves={meta.preservesState} />

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
            <div className="border-amber/30 bg-amber-bg text-amber-fg rounded-md border px-3 py-2 text-[12px] leading-relaxed">
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

function StatePreservationBadge({ message, preserves }: { message: string; preserves: boolean }) {
  if (preserves) {
    return (
      <div className="bg-success-bg/60 text-success-fg flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]">
        <ShieldCheck className="mt-0.5 size-3.5" />
        <span>{message}</span>
      </div>
    );
  }
  return (
    <div className="bg-ember-bg text-ember-fg flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]">
      <Lock className="mt-0.5 size-3.5" />
      <span>{message}</span>
    </div>
  );
}
