import type { AgentCollaboratorRole } from "@mosoo/contracts/agent";
import type { OrganizationMember } from "@mosoo/contracts/organization";
import type { UseQueryResult } from "@tanstack/react-query";
import { Globe, Loader2, Lock } from "lucide-react";
import type { ReactElement } from "react";

import { AccessIconButton } from "@/features/resource-sharing/access-icon-button";
import { AccessRow } from "@/features/resource-sharing/access-row";
import { ShareMemberSearch } from "@/features/resource-sharing/share-member-search";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";

import type { Agent } from "../agent.types";
import type { AgentPublishMode } from "./settings-dialog-model";
import { ROLE_OPTIONS } from "./settings-dialog-model";

function isAgentCollaboratorRole(value: string): value is AgentCollaboratorRole {
  return ROLE_OPTIONS.some((option) => option.value === value);
}

export function AgentSettingsCollaborators({
  agent,
  canManageAccess,
  hasOrganizationAccess,
  mutationError,
  onAddCollaborator,
  onPublishModeChange,
  onRemoveCollaborator,
  onUpdateCollaboratorRole,
  organizationId,
  organizationMembersQuery,
  pendingPrincipal,
  publishModeChangePending,
  search,
  setSearch,
  setShowDropdown,
  showDropdown,
}: {
  agent: Agent;
  canManageAccess: boolean;
  hasOrganizationAccess: boolean;
  mutationError: Error | null;
  onAddCollaborator: (principal: string) => Promise<void>;
  onPublishModeChange: (mode: AgentPublishMode) => void;
  onRemoveCollaborator: (principal: string) => Promise<void>;
  onUpdateCollaboratorRole: (principal: string, role: AgentCollaboratorRole) => Promise<void>;
  organizationId: string | null;
  organizationMembersQuery: UseQueryResult<OrganizationMember[]>;
  pendingPrincipal: string | undefined;
  publishModeChangePending: boolean;
  search: string;
  setSearch: (value: string) => void;
  setShowDropdown: (show: boolean) => void;
  showDropdown: boolean;
}): ReactElement {
  const existingIds = new Set([agent.owner.id, ...agent.collaborators.map((c) => c.user.id)]);
  const showAddEveryoneButton = canManageAccess && !hasOrganizationAccess;

  return (
    <>
      <div className="px-6 pt-5 pb-4">
        <div className="space-y-2">
          <h3 className="text-foreground text-sm font-semibold">Collaborators</h3>
          <ShareMemberSearch
            canManageAccess={canManageAccess}
            disabledMessage="Collaborator changes are limited to the agent owner or organization owner."
            error={organizationMembersQuery.error}
            existingPrincipalIds={existingIds}
            loading={organizationMembersQuery.isLoading}
            members={organizationMembersQuery.data ?? []}
            missingOrganization={organizationId === null}
            onAddMember={async (member) => {
              await onAddCollaborator(member.accountId);
            }}
            onSearchChange={setSearch}
            onShowDropdownChange={setShowDropdown}
            pendingPrincipal={pendingPrincipal}
            search={search}
            showDropdown={showDropdown}
          />
        </div>
      </div>

      <Separator />

      <div className="max-h-[320px] overflow-y-auto p-3">
        <div className="space-y-1">
          <AccessRow
            avatarUser={{ imageUrl: agent.owner.avatar ?? null, name: agent.owner.name }}
            title={agent.owner.name}
            subtitle={agent.owner.email}
            badge="Owner"
            {...(agent.role === "owner" ? { meta: "(you)" } : {})}
          >
            <span className="text-muted-foreground text-xs font-medium">Full access</span>
          </AccessRow>

          {hasOrganizationAccess && (
            <AccessRow
              organizationIcon
              title="Everyone in organization"
              subtitle="All organization members can use"
            >
              <div className="flex items-center gap-1.5">
                {publishModeChangePending ? (
                  <Loader2 className="text-muted-foreground size-4 animate-spin" />
                ) : null}
                <span className="text-muted-foreground text-xs font-medium">Can use</span>
                {canManageAccess ? (
                  <AccessIconButton
                    disabled={publishModeChangePending}
                    label="Remove organization access"
                    onClick={() => {
                      onPublishModeChange("private");
                    }}
                  />
                ) : null}
              </div>
            </AccessRow>
          )}

          {agent.collaborators.map((collab) => {
            const isPending = pendingPrincipal === collab.user.id;
            return (
              <AccessRow
                key={collab.user.id}
                avatarUser={{ imageUrl: collab.user.avatar ?? null, name: collab.user.name }}
                title={collab.user.name}
                subtitle={collab.user.email}
              >
                {canManageAccess ? (
                  <div className="flex items-center gap-1.5">
                    {isPending ? (
                      <Loader2 className="text-muted-foreground size-4 animate-spin" />
                    ) : null}
                    <select
                      value={collab.role}
                      disabled={isPending}
                      onChange={(event) => {
                        const nextRole = event.target.value;

                        if (isAgentCollaboratorRole(nextRole)) {
                          void onUpdateCollaboratorRole(collab.user.id, nextRole);
                        }
                      }}
                      className="border-border bg-background text-foreground focus:ring-primary/20 h-8 rounded-lg border px-2.5 text-xs focus:ring-2 focus:outline-none disabled:opacity-60"
                    >
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <AccessIconButton
                      label={`Remove ${collab.user.name}`}
                      onClick={() => void onRemoveCollaborator(collab.user.id)}
                    />
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs font-medium">
                    {collab.role === "admin" ? "Admin" : "Can use"}
                  </span>
                )}
              </AccessRow>
            );
          })}

          {showAddEveryoneButton ? (
            <div className="flex items-center gap-2 px-2 pt-1">
              <Button
                disabled={publishModeChangePending}
                variant="outline"
                size="xs"
                onClick={() => {
                  onPublishModeChange("organization");
                }}
              >
                Add Everyone in organization
              </Button>
              {publishModeChangePending ? (
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
              ) : null}
            </div>
          ) : null}

          {mutationError !== null ? (
            <div className="text-destructive px-3 pt-2 text-xs">{mutationError.message}</div>
          ) : null}
        </div>
      </div>

      <Separator />

      <div className="px-6 py-4">
        <div className="flex items-center gap-2">
          {hasOrganizationAccess ? (
            <Globe className="text-muted-foreground size-3.5" />
          ) : (
            <Lock className="text-muted-foreground size-3.5" />
          )}
          <span className="text-muted-foreground text-xs">
            {hasOrganizationAccess
              ? "Anyone in the organization can use this agent"
              : "Only people added above have access"}
          </span>
        </div>
      </div>
    </>
  );
}
