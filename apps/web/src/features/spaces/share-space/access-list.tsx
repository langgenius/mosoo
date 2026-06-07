import type { Collaborator, SpaceRole } from "@mosoo/contracts/space";
import { Globe, Loader2, Lock } from "lucide-react";

import { AccessRow } from "@/features/resource-sharing/access-row";

import { isTruthy } from "../../../shared/lib/truthiness";
import { ROLE_LABELS } from "./constants";
import { RoleSelect } from "./role-select";
export function ShareAccessList({
  accessList,
  addingEveryone = false,
  currentUserId,
  error,
  isAdmin,
  loading,
  onAddEveryone,
  onChangeRole,
  onRemove,
  spaceOwnerId,
}: {
  accessList: Collaborator[];
  addingEveryone?: boolean;
  currentUserId: string;
  error: string | null;
  isAdmin: boolean;
  loading: boolean;
  onAddEveryone?: () => void;
  onChangeRole: (principal: string, role: SpaceRole) => void;
  onRemove: (principal: string) => void;
  spaceOwnerId: string | undefined;
}) {
  const wildcardEntry = accessList.find((entry) => entry.principal === "*");
  const collaborators = accessList
    .filter((entry) => entry.principal !== "*")
    .toSorted((left, right) => {
      if (left.principal === spaceOwnerId) {
        return -1;
      }

      if (right.principal === spaceOwnerId) {
        return 1;
      }

      return 0;
    });

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-8">
        <Loader2 className="mr-2 size-4 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <>
      {isTruthy(error) ? (
        <div className="bg-destructive/10 text-destructive mx-3 mb-2 rounded-lg px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      {wildcardEntry ? (
        <AccessRow
          organizationIcon
          title="Everyone in organization"
          subtitle="All organization members"
        >
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">{ROLE_LABELS["read"]}</span>
              <button
                type="button"
                onClick={() => {
                  onRemove("*");
                }}
                className="text-destructive hover:bg-destructive/10 rounded-lg px-2.5 py-1.5 text-xs transition-colors"
              >
                Remove
              </button>
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">{ROLE_LABELS["read"]}</span>
          )}
        </AccessRow>
      ) : null}

      {collaborators.map(({ email, imageUrl, name, principal, role }) => {
        const isOwner = principal === spaceOwnerId;
        const isSelf = principal === currentUserId;

        return (
          <AccessRow
            key={principal}
            avatarUser={{ imageUrl, name }}
            title={name ?? principal}
            subtitle={email ?? ""}
            badge={isOwner ? "Owner" : undefined}
            meta={isSelf ? "(you)" : undefined}
          >
            {isAdmin && !isOwner && !isSelf ? (
              <RoleSelect
                value={role}
                onChange={(nextRole) => {
                  onChangeRole(principal, nextRole);
                }}
                showRemove
                onRemove={() => {
                  onRemove(principal);
                }}
              />
            ) : (
              <span className="text-muted-foreground text-xs">{ROLE_LABELS[role] ?? role}</span>
            )}
          </AccessRow>
        );
      })}

      {collaborators.length === 0 && !wildcardEntry ? (
        <div className="text-muted-foreground flex flex-col items-center justify-center py-8">
          <Lock className="text-border mb-2 size-8" strokeWidth={1.5} />
          <p className="text-sm">No collaborators yet</p>
          <p className="mt-0.5 text-xs">Search above to add people</p>
        </div>
      ) : null}

      {isAdmin && !wildcardEntry && onAddEveryone ? (
        <button
          type="button"
          disabled={addingEveryone}
          onClick={onAddEveryone}
          className="hover:bg-accent/30 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-60"
        >
          <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Globe className="text-muted-foreground size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-foreground text-sm font-medium">Add everyone in organization</div>
            <div className="text-muted-foreground text-xs">
              Gives all organization members view access
            </div>
          </div>
          {addingEveryone ? (
            <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
          ) : null}
        </button>
      ) : null}
    </>
  );
}
