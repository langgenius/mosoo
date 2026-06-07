import type { OrganizationMember, OrganizationMemberRole } from "@mosoo/contracts/organization";
import {
  canRemoveOrganizationMember,
  canUpdateOrganizationMemberRole,
} from "@mosoo/contracts/permission";
import { Check, Crown, MoreHorizontal, Search, Shield, Trash2, UserPlus } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { isTruthy } from "../../shared/lib/truthiness";
export function MembersList({
  currentUserId,
  focusedMemberId,
  filteredMembers,
  memberSearch,
  members,
  onMemberSearchChange,
  onRemove,
  onRoleChange,
  viewerRole,
}: {
  currentUserId: string;
  focusedMemberId: string | null;
  filteredMembers: OrganizationMember[];
  memberSearch: string;
  members: OrganizationMember[];
  onMemberSearchChange: (value: string) => void;
  onRemove: (userId: string) => void;
  onRoleChange: (userId: string, newRole: OrganizationMemberRole) => void;
  viewerRole: OrganizationMemberRole | null | undefined;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-foreground text-[14px] font-semibold">Members</h2>
          <span className="text-muted-foreground text-[12px]">({members.length})</span>
        </div>
        {members.length > 1 ? (
          <div className="relative max-w-[240px] flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <input
              aria-label="Search members by name or email"
              type="search"
              value={memberSearch}
              onChange={(event) => {
                onMemberSearchChange(event.target.value);
              }}
              placeholder="Search name or email…"
              className="border-border bg-background focus:ring-primary/20 focus:border-primary h-8 w-full rounded-lg border pr-2 pl-8 text-[12.5px] focus:ring-2 focus:outline-none"
            />
          </div>
        ) : null}
      </div>

      <div className="border-border bg-card/60 rounded-lg border">
        {filteredMembers.length === 0 ? (
          <div className="text-muted-foreground px-4 py-6 text-center text-sm">
            {isTruthy(focusedMemberId)
              ? "No member matched this Cost row."
              : `No members match "${memberSearch}".`}
          </div>
        ) : (
          filteredMembers.map((member) => (
            <MemberRow
              currentUserId={currentUserId}
              focused={focusedMemberId === member.accountId}
              key={member.accountId}
              member={member}
              onRemove={onRemove}
              onRoleChange={onRoleChange}
              viewerRole={viewerRole}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MemberRow({
  currentUserId,
  focused,
  member,
  onRemove,
  onRoleChange,
  viewerRole,
}: {
  currentUserId: string;
  focused: boolean;
  member: OrganizationMember;
  onRemove: (userId: string) => void;
  onRoleChange: (userId: string, newRole: OrganizationMemberRole) => void;
  viewerRole: OrganizationMemberRole | null | undefined;
}) {
  const isOwner = member.role === "owner";
  const canChangeRole =
    member.accountId !== currentUserId &&
    canUpdateOrganizationMemberRole({
      actorRole: viewerRole,
      nextRole: member.role === "admin" ? "member" : "admin",
      targetRole: member.role,
    });
  const canRemove =
    member.accountId !== currentUserId &&
    canRemoveOrganizationMember({
      actorRole: viewerRole,
      targetRole: member.role,
    });
  const canManage = canChangeRole || canRemove;
  const roleLabel = isOwner ? "Owner" : member.role === "admin" ? "Admin" : "Member";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0",
        focused ? "bg-ink-100" : "",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {isTruthy(member.imageUrl) ? (
          <img
            src={member.imageUrl}
            alt={member.name}
            className="size-9 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{
              background: "linear-gradient(135deg, var(--green-600), var(--green-800))",
            }}
          >
            {member.name?.charAt(0)?.toUpperCase() || "?"}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-[13.5px] font-semibold">
              {member.name}
            </span>
            {isOwner ? (
              <Badge
                variant="outline"
                className="border-amber/30 bg-amber-bg text-amber-fg text-[10px]"
              >
                <Crown className="mr-0.5 size-3" />
                Owner
              </Badge>
            ) : null}
            {member.accountId === currentUserId ? (
              <span className="text-muted-foreground text-[10.5px]">(you)</span>
            ) : null}
          </div>
          <div className="text-muted-foreground truncate text-[11.5px]">{member.email}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-muted-foreground text-[11px] tabular-nums" suppressHydrationWarning>
          Joined {new Date(member.joinedAt).toLocaleDateString()}
        </span>

        <span className="text-muted-foreground min-w-[56px] text-right text-[11.5px]">
          {roleLabel}
        </span>

        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                aria-label="More actions"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 p-1">
              {canChangeRole ? (
                <>
                  <DropdownMenuLabel className="text-muted-foreground px-2 py-1 text-[10.5px] font-semibold tracking-wider uppercase">
                    Role
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={() => {
                      onRoleChange(member.accountId, "admin");
                    }}
                    className="cursor-pointer rounded-md"
                  >
                    <Shield className="size-3.5" />
                    Admin
                    {member.role === "admin" ? (
                      <Check className="text-accent-press ml-auto size-3.5" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      onRoleChange(member.accountId, "member");
                    }}
                    className="cursor-pointer rounded-md"
                  >
                    <UserPlus className="size-3.5" />
                    Member
                    {member.role !== "admin" ? (
                      <Check className="text-accent-press ml-auto size-3.5" />
                    ) : null}
                  </DropdownMenuItem>
                </>
              ) : null}
              {canChangeRole && canRemove ? <DropdownMenuSeparator /> : null}
              {canRemove ? (
                <DropdownMenuItem
                  onSelect={() => {
                    onRemove(member.accountId);
                  }}
                  className="text-destructive focus:text-destructive cursor-pointer rounded-md"
                >
                  <Trash2 className="size-3.5" />
                  Remove from org
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
