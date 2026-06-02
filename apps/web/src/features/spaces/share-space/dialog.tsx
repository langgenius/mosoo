import type { OrganizationMember } from "@mosoo/contracts/organization";
import type { Collaborator, SpaceRole } from "@mosoo/contracts/space";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ShareMemberSearch } from "@/features/resource-sharing/access-primitives";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Separator } from "@/shared/ui/separator";

import { organizationMembers } from "../../../domains/organization/api/organization-client";
import {
  addCollaborator,
  addOrganizationCollaborator,
  getCollaborators,
  removeCollaborator,
  updateCollaborator,
} from "../../../domains/space/api/collaborators";
import { toAccountId, toOrganizationId, toSpaceId } from "../../../routes/typed-id";
import { isTruthy } from "../../../shared/lib/truthiness";
import { ShareAccessList } from "./access-list";
import { getShareDialogErrorMessage } from "./constants";
interface Props {
  currentUserId: string;
  isAdmin: boolean;
  onDeleteSpace?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
  spaceName: string;
  spaceOwnerId?: string;
  organizationId: string;
}

export function SpaceSettingsDialog({
  currentUserId,
  isAdmin,
  onDeleteSpace,
  onOpenChange,
  open,
  spaceId,
  spaceName,
  spaceOwnerId,
  organizationId,
}: Props) {
  const [accessList, setAccessList] = useState<Collaborator[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPrincipal, setPendingPrincipal] = useState<string | null>(null);
  const [addingEveryone, setAddingEveryone] = useState(false);
  const typedCurrentUserId = toAccountId(currentUserId);
  const typedSpaceId = toSpaceId(spaceId);
  const typedOrganizationId = toOrganizationId(organizationId);

  const loadData = useCallback(async () => {
    setLoading(true);

    try {
      const [collaboratorsData, membersData] = await Promise.all([
        getCollaborators(typedSpaceId),
        organizationMembers(typedOrganizationId),
      ]);
      setAccessList(collaboratorsData);
      setMembers(membersData);
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [typedOrganizationId, typedSpaceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const collaboratorPrincipals = new Set(
    accessList.flatMap((entry) => (entry.principal === "*" ? [] : [entry.principal])),
  );

  async function handleAddMember(userId: string, role: SpaceRole = "read") {
    if (isTruthy(pendingPrincipal)) {
      return;
    }
    if (accessList.some((entry) => entry.principal === userId)) {
      return;
    }

    setError(null);

    const member = members.find((entry) => entry.accountId === userId);

    if (!isTruthy(member?.email)) {
      setError(getShareDialogErrorMessage(new Error("member email not found")));
      return;
    }

    setPendingPrincipal(userId);
    setSearch("");
    setShowDropdown(false);

    try {
      await addCollaborator(typedSpaceId, { email: member.email, role });
      setAccessList((prev) => [
        ...prev.filter((entry) => entry.principal !== userId),
        {
          assignedBy: typedCurrentUserId,
          createdAt: new Date().toISOString(),
          email: member.email,
          imageUrl: member.imageUrl,
          name: member.name,
          principal: userId,
          role,
        },
      ]);
    } catch (caughtError: unknown) {
      setError(getShareDialogErrorMessage(caughtError));
    } finally {
      setPendingPrincipal(null);
    }
  }

  async function handleAddEveryone() {
    if (addingEveryone) {
      return;
    }
    if (accessList.some((entry) => entry.principal === "*")) {
      return;
    }

    setError(null);
    setAddingEveryone(true);

    try {
      await addOrganizationCollaborator(typedSpaceId);
      setAccessList((prev) => [
        ...prev.filter((entry) => entry.principal !== "*"),
        {
          assignedBy: typedCurrentUserId,
          createdAt: new Date().toISOString(),
          email: null,
          imageUrl: null,
          name: null,
          principal: "*",
          role: "read",
        },
      ]);
    } catch (caughtError: unknown) {
      setError(getShareDialogErrorMessage(caughtError));
    } finally {
      setAddingEveryone(false);
    }
  }

  async function handleChangeRole(principal: string, role: SpaceRole) {
    setError(null);

    try {
      if (principal === "*") {
        return;
      }

      await updateCollaborator(typedSpaceId, toAccountId(principal), { role });
      setAccessList((prev) =>
        prev.map((entry) => (entry.principal === principal ? { ...entry, role } : entry)),
      );
    } catch (caughtError: unknown) {
      setError(getShareDialogErrorMessage(caughtError));
    }
  }

  async function handleRemove(principal: string) {
    setError(null);

    try {
      await removeCollaborator(typedSpaceId, principal);
      setAccessList((prev) => prev.filter((entry) => entry.principal !== principal));
    } catch (caughtError: unknown) {
      setError(getShareDialogErrorMessage(caughtError));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[520px]">
        <DialogHeader className="shrink-0 gap-1 px-5 pt-5 pb-0">
          <DialogTitle className="text-base font-semibold" style={{ letterSpacing: "-0.2px" }}>
            Space Settings
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Manage collaborators and deletion for <span className="break-all">"{spaceName}"</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 px-5 pt-4 pb-3">
          {isAdmin ? (
            <ShareMemberSearch
              disableAllWhilePending
              existingPrincipalIds={collaboratorPrincipals}
              loading={loading}
              members={members}
              onAddMember={async (member) => {
                await handleAddMember(member.accountId);
              }}
              onSearchChange={setSearch}
              onShowDropdownChange={setShowDropdown}
              pendingPrincipal={pendingPrincipal}
              search={search}
              showDropdown={showDropdown}
            />
          ) : null}
        </div>

        <Separator />

        <div className="min-h-0 overflow-y-auto p-2">
          <ShareAccessList
            accessList={accessList}
            currentUserId={currentUserId}
            error={error}
            isAdmin={isAdmin}
            loading={loading}
            addingEveryone={addingEveryone}
            onAddEveryone={() => void handleAddEveryone()}
            onChangeRole={(principal, role) => void handleChangeRole(principal, role)}
            onRemove={(principal) => void handleRemove(principal)}
            spaceOwnerId={spaceOwnerId}
          />
        </div>

        {isAdmin && onDeleteSpace ? (
          <>
            <Separator />
            <div className="shrink-0 space-y-2 px-5 py-4">
              <h4 className="text-destructive text-xs font-semibold">Danger Zone</h4>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Deleting a space is permanent. All files will be removed and active sessions will be
                unlinked.
              </p>
              <Button
                variant="outline"
                size="xs"
                onClick={onDeleteSpace}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Delete this space
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
