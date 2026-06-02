import { Globe, Loader2, Search, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";

export interface ShareMember {
  accountId: string;
  email: string;
  imageUrl: string | null;
  name: string;
}

interface AvatarUser {
  avatar?: string | null;
  imageUrl?: string | null;
  name: string | null | undefined;
}

function getAvatarUrl(user: AvatarUser): string | null {
  return user.imageUrl ?? user.avatar ?? null;
}

function ShareUserAvatar({ size, user }: { size?: "sm"; user: AvatarUser }): ReactElement {
  const imageUrl = getAvatarUrl(user);
  const name = user.name ?? "?";
  const hasImageUrl = imageUrl !== null && imageUrl.length > 0;

  return (
    <Avatar {...(size === undefined ? {} : { size })}>
      {hasImageUrl ? <AvatarImage src={imageUrl} alt={name} referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="bg-primary/10 text-primary font-medium">
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function OrganizationAvatar(): ReactElement {
  return (
    <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
      <Globe className="text-muted-foreground size-4" />
    </div>
  );
}

export function AccessIconButton({
  disabled = false,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-destructive",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <X className="size-3.5" />
    </button>
  );
}

interface BaseAccessRowProps {
  badge?: string | undefined;
  children: ReactNode;
  meta?: string | undefined;
  subtitle?: string | null;
  title: string;
}

type AccessRowProps =
  | (BaseAccessRowProps & {
      avatarUser: AvatarUser;
      organizationIcon?: false;
    })
  | (BaseAccessRowProps & {
      avatarUser?: never;
      organizationIcon: true;
    });

export function AccessRow(props: AccessRowProps): ReactElement {
  const { badge, children, meta, subtitle, title } = props;
  const icon =
    props.organizationIcon === true ? (
      <OrganizationAvatar />
    ) : (
      <ShareUserAvatar user={props.avatarUser} />
    );

  return (
    <div className="hover:bg-accent/30 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-foreground truncate text-sm font-medium">{title}</span>
            {badge ? (
              <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                {badge}
              </span>
            ) : null}
            {meta ? <span className="text-muted-foreground text-[10px]">{meta}</span> : null}
          </div>
          {subtitle ? (
            <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function matchesMember(member: ShareMember, searchQuery: string): boolean {
  return (
    member.name.toLowerCase().includes(searchQuery) ||
    member.email.toLowerCase().includes(searchQuery)
  );
}

function DropdownMessage({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "danger" | "muted";
}): ReactElement {
  const colorClass = tone === "danger" ? "text-destructive" : "text-muted-foreground";

  return <div className={`${colorClass} px-4 py-3 text-sm`}>{children}</div>;
}

function ShareMemberSearchDropdown({
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
    return <DropdownMessage>Organization context is missing</DropdownMessage>;
  }

  if (loading) {
    return <DropdownMessage>Loading members…</DropdownMessage>;
  }

  if (error !== undefined && error !== null) {
    return <DropdownMessage tone="danger">{error.message}</DropdownMessage>;
  }

  if (searchResults.length === 0) {
    return <DropdownMessage>No matching members found</DropdownMessage>;
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

export function ShareMemberSearch({
  canManageAccess = true,
  disabledMessage,
  disableAllWhilePending = false,
  error,
  existingPrincipalIds,
  loading = false,
  missingOrganization = false,
  members,
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
        placeholder="Search by name or email…"
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
