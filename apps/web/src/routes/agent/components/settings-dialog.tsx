import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useState } from "react";

import {
  addAgentCollaborator,
  publishAgent,
  removeAgentCollaborator,
  updateAgentCollaborator,
} from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { useOrganizationMembersQuery } from "@/domains/organization/query/organization-queries";
import { toAgentId } from "@/routes/typed-id";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Separator } from "@/shared/ui/separator";

import type { Agent } from "../agent.types";
import { AgentSettingsSummary } from "./settings-dialog-agent-summary";
import { AgentSettingsCollaborators } from "./settings-dialog-collaborators";
import { AgentSettingsDangerZone } from "./settings-dialog-danger-zone";
import { AgentSettingsPackageActions } from "./settings-dialog-package-actions";

export function SettingsSheet({
  agent,
  canManageAccess = true,
  open,
  onOpenChange,
  organizationId,
}: {
  agent: Agent;
  canManageAccess?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const typedAgentId = toAgentId(agent.id);

  const addCollaboratorMutation = useMutation({
    mutationFn: addAgentCollaborator,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.editorState(agent.id) });
    },
  });
  const updateCollaboratorMutation = useMutation({
    mutationFn: updateAgentCollaborator,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.editorState(agent.id) });
    },
  });
  const removeCollaboratorMutation = useMutation({
    mutationFn: removeAgentCollaborator,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.editorState(agent.id) });
    },
  });
  const publishMutation = useMutation({
    mutationFn: publishAgent,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agent.id) }),
        queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
      ]);
    },
  });
  const organizationMembersQuery = useOrganizationMembersQuery(
    canManageAccess ? organizationId : null,
  );

  const collaboratorMutationError =
    addCollaboratorMutation.error ??
    updateCollaboratorMutation.error ??
    removeCollaboratorMutation.error ??
    publishMutation.error;

  const hasOrganizationAccess = agent.visibility === "organization";
  const pendingCollaboratorPrincipal = addCollaboratorMutation.isPending
    ? addCollaboratorMutation.variables.principal
    : updateCollaboratorMutation.isPending
      ? updateCollaboratorMutation.variables.principal
      : removeCollaboratorMutation.isPending
        ? removeCollaboratorMutation.variables.principal
        : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-x-hidden overflow-y-auto rounded-lg p-0 sm:max-w-[620px]">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>Agent Settings</DialogTitle>
          <DialogDescription>
            {canManageAccess
              ? `Manage collaborators and settings for "${agent.name}".`
              : `View settings for "${agent.name}".`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pt-5 pb-4">
          <AgentSettingsSummary agent={agent} />
          <AgentSettingsPackageActions
            agent={agent}
            canManageAccess={canManageAccess}
            onSettingsOpenChange={onOpenChange}
            organizationId={organizationId}
          />
        </div>

        <Separator />

        <AgentSettingsCollaborators
          agent={agent}
          canManageAccess={canManageAccess}
          hasOrganizationAccess={hasOrganizationAccess}
          mutationError={collaboratorMutationError}
          onAddCollaborator={async (principal) =>
            addCollaboratorMutation.mutateAsync({
              agentId: typedAgentId,
              principal,
              role: "user",
            })
          }
          onPublishModeChange={(mode) => {
            publishMutation.mutate({
              agentId: typedAgentId,
              visibility: mode === "organization" ? "organization" : "private",
            });
          }}
          onRemoveCollaborator={async (principal) =>
            removeCollaboratorMutation.mutateAsync({ agentId: typedAgentId, principal })
          }
          onUpdateCollaboratorRole={async (principal, role) =>
            updateCollaboratorMutation.mutateAsync({ agentId: typedAgentId, principal, role })
          }
          organizationId={organizationId}
          organizationMembersQuery={organizationMembersQuery}
          pendingPrincipal={pendingCollaboratorPrincipal}
          publishModeChangePending={publishMutation.isPending}
          search={search}
          setSearch={setSearch}
          setShowDropdown={setShowDropdown}
          showDropdown={showDropdown}
        />

        {canManageAccess ? (
          <>
            <Separator />
            <AgentSettingsDangerZone agent={agent} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
