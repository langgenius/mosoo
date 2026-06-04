import type { SkillShareTarget, SkillSummary } from "@mosoo/contracts/skill";
import { useEffect, useReducer } from "react";

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

interface ShareSkillDialogState {
  email: string;
  error: string | null;
  loading: boolean;
  submitting: boolean;
  targets: SkillShareTarget[];
}

type ShareSkillDialogAction =
  | { type: "changeEmail"; email: string }
  | { type: "loadFailed"; error: string }
  | { type: "loadSucceeded"; targets: SkillShareTarget[] }
  | { type: "setError"; error: string | null }
  | { type: "setSubmitting"; submitting: boolean };

const SHARE_SKILL_DIALOG_INITIAL_STATE: ShareSkillDialogState = {
  email: "",
  error: null,
  loading: true,
  submitting: false,
  targets: [],
};

function shareSkillDialogReducer(
  state: ShareSkillDialogState,
  action: ShareSkillDialogAction,
): ShareSkillDialogState {
  switch (action.type) {
    case "changeEmail":
      return { ...state, email: action.email };
    case "loadFailed":
      return { ...state, error: action.error, loading: false };
    case "loadSucceeded":
      return { ...state, loading: false, targets: action.targets };
    case "setError":
      return { ...state, error: action.error };
    case "setSubmitting":
      return { ...state, submitting: action.submitting };
  }
}

export function ShareSkillDialog({ onOpenChange, open, registry, skill }: Props) {
  const [state, dispatch] = useReducer(shareSkillDialogReducer, SHARE_SKILL_DIALOG_INITIAL_STATE);
  const { email, error, loading, submitting, targets } = state;

  useEffect(() => {
    if (!open) {
      return;
    }
    const abortController = new AbortController();
    void (async () => {
      try {
        const detail = await registry.getSkillDetail(skill.id);
        if (!abortController.signal.aborted) {
          dispatch({ targets: detail.shareTargets, type: "loadSucceeded" });
        }
      } catch (caughtError) {
        if (!abortController.signal.aborted) {
          dispatch({
            error: caughtError instanceof Error ? caughtError.message : String(caughtError),
            type: "loadFailed",
          });
        }
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [open, skill.id, registry]);

  async function refresh() {
    try {
      dispatch({
        targets: (await registry.getSkillDetail(skill.id)).shareTargets,
        type: "loadSucceeded",
      });
    } catch (caughtError) {
      dispatch({
        error: caughtError instanceof Error ? caughtError.message : String(caughtError),
        type: "setError",
      });
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
    dispatch({ error: null, type: "setError" });
    dispatch({ submitting: true, type: "setSubmitting" });
    try {
      await registry.shareSkillWithUser(skill.id, clean);
      dispatch({ email: "", type: "changeEmail" });
      await refresh();
    } catch (caughtError) {
      dispatch({
        error: caughtError instanceof Error ? caughtError.message : String(caughtError),
        type: "setError",
      });
    } finally {
      dispatch({ submitting: false, type: "setSubmitting" });
    }
  }

  async function handleAddEveryone() {
    if (submitting) {
      return;
    }
    dispatch({ error: null, type: "setError" });
    dispatch({ submitting: true, type: "setSubmitting" });
    try {
      await registry.shareSkillWithOrganization(skill.id);
      await refresh();
    } catch (caughtError) {
      dispatch({
        error: caughtError instanceof Error ? caughtError.message : String(caughtError),
        type: "setError",
      });
    } finally {
      dispatch({ submitting: false, type: "setSubmitting" });
    }
  }

  async function handleRemove(target: SkillShareTarget) {
    if (submitting) {
      return;
    }
    dispatch({ error: null, type: "setError" });
    dispatch({ submitting: true, type: "setSubmitting" });
    try {
      await registry.unshareSkillTarget(skill.id, target);
      await refresh();
    } catch (caughtError) {
      dispatch({
        error: caughtError instanceof Error ? caughtError.message : String(caughtError),
        type: "setError",
      });
    } finally {
      dispatch({ submitting: false, type: "setSubmitting" });
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
              dispatch({ email: e.target.value, type: "changeEmail" });
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
