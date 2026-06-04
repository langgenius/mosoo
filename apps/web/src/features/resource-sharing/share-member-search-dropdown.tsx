import { Loader2 } from "lucide-react";
import type { ReactElement } from "react";

import type { ShareMember } from "./access-model";
import { ShareUserAvatar } from "./share-user-avatar";

function renderDropdownMessage(children: string, tone: "danger" | "muted" = "muted"): ReactElement {
  const colorClass = tone === "danger" ? "text-destructive" : "text-muted-foreground";

  return <div className={`${colorClass} px-4 py-3 text-sm`}>{children}</div>;
}

export function ShareMemberSearchDropdown({
  disableAllWhilePending,
  error,
  loading,
  missingOrganization,
  onAddMember,
  pendingPrincipal,
  searchResults,
}: {
  disableAllWhilePending: boolean;
  error: Error | null | undefined;
  loading: boolean;
  missingOrganization: boolean;
  onAddMember: (member: ShareMember) => void;
  pendingPrincipal: string | null | undefined;
  searchResults: ShareMember[];
}): ReactElement {
  if (missingOrganization) {
    return renderDropdownMessage("Organization context is missing");
  }

  if (loading) {
    return renderDropdownMessage("Loading members\u2026");
  }

  if (error !== undefined && error !== null) {
    return renderDropdownMessage(error.message, "danger");
  }

  if (searchResults.length === 0) {
    return renderDropdownMessage("No matching members found");
  }

  return (
    <div className="max-h-[220px] overflow-y-auto py-1">
      {searchResults.map((member) => {
        const isAdding = pendingPrincipal === member.accountId;
        const disabled = disableAllWhilePending
          ? pendingPrincipal !== null && pendingPrincipal !== undefined
          : isAdding;

        return (
          <button
            className="hover:bg-accent/50 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-60"
            disabled={disabled}
            key={member.accountId}
            onClick={() => {
              onAddMember(member);
            }}
            type="button"
          >
            <ShareUserAvatar size="sm" user={member} />
            <div className="min-w-0 flex-1">
              <div className="text-foreground truncate text-sm font-medium">{member.name}</div>
              <div className="text-muted-foreground truncate text-xs">{member.email}</div>
            </div>
            {isAdding ? (
              <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
