import type { SkillSummary } from "@mosoo/contracts/skill";
import { useEffect, useState } from "react";

import { useOrganizationMembersQuery } from "@/domains/organization/query/organization-queries";
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
  const [directCount, setDirectCount] = useState(0);
  const [organizationWide, setOrganizationWide] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const membersQuery = useOrganizationMembersQuery(open ? skill.organizationId : null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const abortController = new AbortController();
    void (async () => {
      try {
        const detail = await registry.getSkillDetail(skill.id);
        if (abortController.signal.aborted) {
          return;
        }
        setDirectCount(detail.shareTargets.filter((target) => target.kind === "user").length);
        setOrganizationWide(detail.shareTargets.some((target) => target.kind === "organization"));
      } catch {
        /* Best-effort — fall back to no cascade warning */
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [open, skill.id, skill.ownerId, registry]);

  const activeMemberCount =
    membersQuery.data?.filter(
      (member) => member.status === "active" && member.accountId !== skill.ownerId,
    ).length ?? 0;
  const impactedUserCount = organizationWide ? activeMemberCount : directCount;

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

        {impactedUserCount > 0 || organizationWide ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="mb-0.5 font-medium">Personal fork transfer</div>
            <div>
              <span className="font-semibold">{impactedUserCount}</span>{" "}
              {impactedUserCount === 1 ? "user" : "users"} currently use this skill. After deletion,
              each user automatically receives a fork in their personal section and becomes its
              owner.
            </div>
          </div>
        ) : null}

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
