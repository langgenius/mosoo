import type { OrganizationMember } from "@mosoo/contracts/organization";
import type { Collaborator, SpaceRole } from "@mosoo/contracts/space";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useReducer } from "react";

import { ShareMemberSearch } from "@/features/resource-sharing/share-member-search";
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

interface SpaceSettingsDialogState {
  accessList: Collaborator[];
  addingEveryone: boolean;
  error: string | null;
  loading: boolean;
  members: OrganizationMember[];
  pendingPrincipal: string | null;
  search: string;
  showDropdown: boolean;
}

type SpaceSettingsDialogAction =
  | { type: "addCollaborator"; collaborator: Collaborator }
  | { type: "loadFailed"; error: string }
  | { type: "loadStarted" }
  | { type: "loadSucceeded"; accessList: Collaborator[]; members: OrganizationMember[] }
  | { type: "removeCollaborator"; principal: string }
  | { type: "setAddingEveryone"; adding: boolean }
  | { type: "setError"; error: string | null }
  | { type: "setPendingPrincipal"; principal: string | null }
  | { type: "setSearch"; search: string }
  | { type: "setShowDropdown"; show: boolean }
  | { type: "updateCollaboratorRole"; principal: string; role: SpaceRole };

const SPACE_SETTINGS_DIALOG_INITIAL_STATE: SpaceSettingsDialogState = {
  accessList: [],
  addingEveryone: false,
  error: null,
  loading: true,
  members: [],
  pendingPrincipal: null,
  search: "",
  showDropdown: false,
};

function spaceSettingsDialogReducer(
  state: SpaceSettingsDialogState,
  action: SpaceSettingsDialogAction,
): SpaceSettingsDialogState {
  switch (action.type) {
    case "addCollaborator":
      return {
        ...state,
        accessList: [
          ...state.accessList.filter((entry) => entry.principal !== action.collaborator.principal),
          action.collaborator,
        ],
      };
    case "loadFailed":
      return { ...state, error: action.error, loading: false };
    case "loadStarted":
      return { ...state, loading: true };
    case "loadSucceeded":
      return {
        ...state,
        accessList: action.accessList,
        loading: false,
        members: action.members,
      };
    case "removeCollaborator":
      return {
        ...state,
        accessList: state.accessList.filter((entry) => entry.principal !== action.principal),
      };
    case "setAddingEveryone":
      return { ...state, addingEveryone: action.adding };
    case "setError":
      return { ...state, error: action.error };
    case "setPendingPrincipal":
      return { ...state, pendingPrincipal: action.principal };
    case "setSearch":
      return { ...state, search: action.search };
    case "setShowDropdown":
      return { ...state, showDropdown: action.show };
    case "updateCollaboratorRole":
      return {
        ...state,
        accessList: state.accessList.map((entry) =>
          entry.principal === action.principal ? { ...entry, role: action.role } : entry,
        ),
      };
  }
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
  const [state, dispatch] = useReducer(
    spaceSettingsDialogReducer,
    SPACE_SETTINGS_DIALOG_INITIAL_STATE,
  );
  const {
    accessList,
    addingEveryone,
    error,
    loading,
    members,
    pendingPrincipal,
    search,
    showDropdown,
  } = state;
  const typedCurrentUserId = toAccountId(currentUserId);
  const typedSpaceId = toSpaceId(spaceId);
  const typedOrganizationId = toOrganizationId(organizationId);

  const loadData = useCallback(async () => {
    dispatch({ type: "loadStarted" });

    try {
      const [collaboratorsData, membersData] = await Promise.all([
        getCollaborators(typedSpaceId),
        organizationMembers(typedOrganizationId),
      ]);
      dispatch({
        accessList: collaboratorsData,
        members: membersData,
        type: "loadSucceeded",
      });
    } catch {
      dispatch({ error: "Failed to load data", type: "loadFailed" });
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

    dispatch({ error: null, type: "setError" });

    const member = members.find((entry) => entry.accountId === userId);

    if (!isTruthy(member?.email)) {
      dispatch({
        error: getShareDialogErrorMessage(new Error("member email not found")),
        type: "setError",
      });
      return;
    }

    dispatch({ principal: userId, type: "setPendingPrincipal" });
    dispatch({ search: "", type: "setSearch" });
    dispatch({ show: false, type: "setShowDropdown" });

    try {
      await addCollaborator(typedSpaceId, { email: member.email, role });
      dispatch({
        collaborator: {
          assignedBy: typedCurrentUserId,
          createdAt: new Date().toISOString(),
          email: member.email,
          imageUrl: member.imageUrl,
          name: member.name,
          principal: userId,
          role,
        },
        type: "addCollaborator",
      });
    } catch (caughtError: unknown) {
      dispatch({ error: getShareDialogErrorMessage(caughtError), type: "setError" });
    } finally {
      dispatch({ principal: null, type: "setPendingPrincipal" });
    }
  }

  async function handleAddEveryone() {
    if (addingEveryone) {
      return;
    }
    if (accessList.some((entry) => entry.principal === "*")) {
      return;
    }

    dispatch({ error: null, type: "setError" });
    dispatch({ adding: true, type: "setAddingEveryone" });

    try {
      await addOrganizationCollaborator(typedSpaceId);
      dispatch({
        collaborator: {
          assignedBy: typedCurrentUserId,
          createdAt: new Date().toISOString(),
          email: null,
          imageUrl: null,
          name: null,
          principal: "*",
          role: "read",
        },
        type: "addCollaborator",
      });
    } catch (caughtError: unknown) {
      dispatch({ error: getShareDialogErrorMessage(caughtError), type: "setError" });
    } finally {
      dispatch({ adding: false, type: "setAddingEveryone" });
    }
  }

  async function handleChangeRole(principal: string, role: SpaceRole) {
    dispatch({ error: null, type: "setError" });

    try {
      if (principal === "*") {
        return;
      }

      await updateCollaborator(typedSpaceId, toAccountId(principal), { role });
      dispatch({ principal, role, type: "updateCollaboratorRole" });
    } catch (caughtError: unknown) {
      dispatch({ error: getShareDialogErrorMessage(caughtError), type: "setError" });
    }
  }

  async function handleRemove(principal: string) {
    dispatch({ error: null, type: "setError" });

    try {
      await removeCollaborator(typedSpaceId, principal);
      dispatch({ principal, type: "removeCollaborator" });
    } catch (caughtError: unknown) {
      dispatch({ error: getShareDialogErrorMessage(caughtError), type: "setError" });
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
              onSearchChange={(nextSearch) => {
                dispatch({ search: nextSearch, type: "setSearch" });
              }}
              onShowDropdownChange={(show) => {
                dispatch({ show, type: "setShowDropdown" });
              }}
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
