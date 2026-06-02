import type { SkillShareTarget, SkillSummary } from "@mosoo/contracts/skill";
import { useEffect, useState } from "react";

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

import { isTruthy } from "../../../shared/lib/truthiness";
import type { useSkillRegistry } from "./use-skill-registry";
type Registry = ReturnType<typeof useSkillRegistry>;

interface Props {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  registry: Registry;
  skill: SkillSummary;
}

export function ShareSkillDialog({ onOpenChange, open, registry, skill }: Props) {
  const [email, setEmail] = useState("");
  const [targets, setTargets] = useState<SkillShareTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const abortController = new AbortController();
    void (async () => {
      try {
        const detail = await registry.getSkillDetail(skill.id);
        if (!abortController.signal.aborted) {
          setTargets(detail.shareTargets);
        }
      } catch (caughtError) {
        if (!abortController.signal.aborted) {
          setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [open, skill.id, registry]);

  async function refresh() {
    try {
      setTargets((await registry.getSkillDetail(skill.id)).shareTargets);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    }
  }

  async function handleAdd() {
    if (submitting) {
      return;
    }
    const clean = email.trim();
    if (!clean) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await registry.shareSkillWithUser(skill.id, clean);
      setEmail("");
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddEveryone() {
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await registry.shareSkillWithOrganization(skill.id);
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(target: SkillShareTarget) {
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await registry.unshareSkillTarget(skill.id, target);
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setSubmitting(false);
    }
  }

  const directCollabs = targets.filter((target) => target.kind === "user");
  const organizationTarget = targets.find((target) => target.kind === "organization") ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share skill</DialogTitle>
          <DialogDescription>
            Invited members will see this skill in their "Share with me" section. They can enable or
            disable it and create a fork, but they cannot edit, delete, or remove the share
            themselves.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            type="email"
            placeholder="Teammate email..."
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleAdd();
              }
            }}
            disabled={submitting}
          />
          <Button size="sm" onClick={() => void handleAdd()} disabled={submitting || !email.trim()}>
            Add
          </Button>
        </div>

        {loading ? (
          <div className="text-muted-foreground py-2 text-xs">Loading…</div>
        ) : directCollabs.length > 0 ? (
          <div className="divide-border border-border bg-card flex flex-col divide-y rounded-md border">
            {directCollabs.map((target) => (
              <div key={target.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate text-sm font-medium">
                    {target.name ?? target.id}
                  </div>
                  {isTruthy(target.email) ? (
                    <div className="text-muted-foreground truncate text-xs">{target.email}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleRemove(target)}
                  className="text-muted-foreground hover:text-destructive text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-60"
                  aria-label="Remove"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground py-1 text-xs">No collaborators added yet.</div>
        )}

        <div className="border-border flex items-center justify-between rounded-md border px-3 py-2.5">
          <div>
            <div className="text-sm font-medium">Entire organization</div>
            <div className="text-muted-foreground text-xs">
              {organizationTarget
                ? "Enabled: visible to everyone in the organization"
                : "Once enabled, everyone in the organization will see this skill"}
            </div>
          </div>
          {organizationTarget ? (
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => void handleRemove(organizationTarget)}
            >
              Stop sharing
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => void handleAddEveryone()}
            >
              Share with everyone
            </Button>
          )}
        </div>

        {isTruthy(error) ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Close sharing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
