import { Search } from "lucide-react";
import type { ReactElement } from "react";

import { matchesMember } from "./access-model";
import type { ShareMember } from "./access-model";
import { ShareMemberSearchDropdown } from "./share-member-search-dropdown";

export function ShareMemberSearch({
  canManageAccess = true,
  disabledMessage,
  disableAllWhilePending = false,
  error,
  existingPrincipalIds,
  loading = false,
  members,
  missingOrganization = false,
  onAddMember,
  onSearchChange,
  onShowDropdownChange,
  pendingPrincipal,
  search,
  showDropdown,
}: {
  canManageAccess?: boolean;
  disabledMessage?: string;
  disableAllWhilePending?: boolean;
  error?: Error | null;
  existingPrincipalIds: ReadonlySet<string>;
  loading?: boolean;
  members: ShareMember[];
  missingOrganization?: boolean;
  onAddMember: (member: ShareMember) => Promise<void> | void;
  onSearchChange: (value: string) => void;
  onShowDropdownChange: (show: boolean) => void;
  pendingPrincipal?: string | null | undefined;
  search: string;
  showDropdown: boolean;
}): ReactElement {
  const searchQuery = search.trim().toLowerCase();
  const searchResults =
    searchQuery.length === 0
      ? []
      : members.filter(
          (member) =>
            !existingPrincipalIds.has(member.accountId) && matchesMember(member, searchQuery),
        );

  function addMember(member: ShareMember): void {
    void Promise.resolve(onAddMember(member))
      .then(() => {
        onSearchChange("");
        onShowDropdownChange(false);
      })
      .catch((caughtError: unknown) => {
        void caughtError;
      });
  }

  if (!canManageAccess) {
    return (
      <div className="border-border bg-muted/30 text-muted-foreground rounded-md border px-3 py-2 text-xs">
        {disabledMessage}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <input
        aria-label="Search members by name or email"
        className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary/20 h-10 w-full rounded-md border pr-3 pl-9 text-sm transition-colors focus:ring-2 focus:outline-none"
        onChange={(event) => {
          onSearchChange(event.target.value);
          onShowDropdownChange(true);
        }}
        onFocus={() => {
          if (search.trim().length > 0) {
            onShowDropdownChange(true);
          }
        }}
        placeholder={"Search by name or email\u2026"}
        type="text"
        value={search}
      />

      {showDropdown && searchQuery.length > 0 ? (
        <div className="border-border bg-background absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border shadow-lg">
          <ShareMemberSearchDropdown
            disableAllWhilePending={disableAllWhilePending}
            error={error}
            loading={loading}
            missingOrganization={missingOrganization}
            onAddMember={addMember}
            pendingPrincipal={pendingPrincipal}
            searchResults={searchResults}
          />
        </div>
      ) : null}

      {showDropdown ? (
        <button
          aria-label="Close member menu"
          className="fixed inset-0 z-40"
          onClick={() => {
            onShowDropdownChange(false);
          }}
          type="button"
        />
      ) : null}
    </div>
  );
}
