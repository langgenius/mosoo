import type { SkillSummary } from "@mosoo/contracts/skill";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { useSkillRegistry } from "./use-skill-registry";
type Registry = ReturnType<typeof useSkillRegistry>;

interface Props {
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  registry: Registry;
  skill: SkillSummary;
}

export function DeleteSkillDialog({ onDeleted, onOpenChange, open, registry, skill }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await registry.deleteOwnedSkill(skill.id);
      onDeleted();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete skill</DialogTitle>
          <DialogDescription>
            This removes <span className="font-medium">{skill.name}</span> from your registry.
          </DialogDescription>
        </DialogHeader>

        {isTruthy(error) ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
