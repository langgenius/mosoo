import type { AgentConfigChangeAction } from "@mosoo/contracts/agent-config-change-plan";
import { Lock, ShieldCheck } from "lucide-react";

import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

/**
 * Runtime action levels exposed to operators when they save Live-state
 * config edits. The shared classifier in @mosoo/contracts picks the level based
 * on which fields changed. Agent state is preserved for every supported action.
 */
export type LifecycleActionKind = Exclude<AgentConfigChangeAction, "direct-update">;

interface ActionMeta {
  title: string;
  body: string;
  primary: string;
  preservesState: boolean;
  stateNotice: string;
  danger: "low" | "medium";
}

const META = {
  "patch-and-restart": {
    body: "agentLifecycle.livePatchBody",
    danger: "low",
    preservesState: true,
    primary: "agentLifecycle.applyNow",
    stateNotice: "agentLifecycle.sandboxReusedNotice",
    title: "agentLifecycle.livePatchTitle",
  },
  "recreate-preserving-state": {
    body: "agentLifecycle.liveRecreateBody",
    danger: "medium",
    preservesState: true,
    primary: "agentLifecycle.recreateNow",
    stateNotice: "agentLifecycle.recreateStateNotice",
    title: "agentLifecycle.liveRecreateTitle",
  },
  "fork-agent": {
    body: "agentLifecycle.liveForkBody",
    danger: "medium",
    preservesState: true,
    primary: "agentLifecycle.forkWithNewRuntime",
    stateNotice: "agentLifecycle.forkStateNotice",
    title: "agentLifecycle.liveForkTitle",
  },
  "restart-process": {
    body: "agentLifecycle.liveRestartBody",
    danger: "low",
    preservesState: true,
    primary: "agentLifecycle.applyNow",
    stateNotice: "agentLifecycle.sandboxReusedNotice",
    title: "agentLifecycle.liveRestartTitle",
  },
} satisfies Record<LifecycleActionKind, ActionMeta>;

function resolveMeta(
  t: ReturnType<typeof useTranslation>["t"],
  kind: LifecycleActionKind,
): ActionMeta {
  const meta = META[kind];
  return {
    body: t(meta.body),
    danger: meta.danger,
    preservesState: meta.preservesState,
    primary: t(meta.primary),
    stateNotice: t(meta.stateNotice),
    title: t(meta.title),
  };
}

export function LiveConfigActionDialog({
  affectedFields,
  busy = false,
  kind,
  onCancel,
  onConfirm,
  open,
}: {
  affectedFields: string[];
  busy?: boolean;
  kind: LifecycleActionKind;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const meta = resolveMeta(t, kind);
  const forkBlocked = kind === "fork-agent";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{meta.title}</DialogTitle>
          <DialogDescription className="text-fg-2 text-[12.5px] leading-relaxed">
            {meta.body}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <StatePreservationBadge message={meta.stateNotice} preserves={meta.preservesState} />

          {affectedFields.length > 0 ? (
            <div className="border-border-subtle bg-bg-1 rounded-md border px-3 py-2">
              <div className="text-fg-3 mb-1 text-[11px] font-medium tracking-wide uppercase">
                {t("agentLifecycle.fieldsInChange")}
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
              {t("agentLifecycle.forkNotWiredNotice")}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => {
              onCancel();
            }}
            size="sm"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || forkBlocked}
            onClick={() => {
              onConfirm();
            }}
            size="sm"
          >
            {busy ? t("agentLifecycle.working") : meta.primary}
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
