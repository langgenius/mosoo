import type {
  OrganizationAccessRequest,
  OrganizationInvitation,
  OrganizationJoinPolicy,
  OrganizationMember,
  OrganizationMemberRole,
} from "@mosoo/contracts/organization";
import {
  Permission,
  can,
  canRemoveOrganizationMember,
  canUpdateOrganizationMemberRole,
} from "@mosoo/contracts/permission";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAppSession } from "../../app/session-provider";
import {
  cancelOrganizationInvitation,
  inviteMember,
  removeMember,
  requestOrganizationInvitation,
  reviewOrganizationAccessRequest,
  updateJoinPolicy,
  updateMemberRole,
  updateOrganizationPrimaryDomain,
  organizationAccessRequests,
  organizationInvitations,
  organizationMembers,
} from "../../domains/organization/api/organization-client";
import type { Organization } from "../../domains/organization/api/organization-client";
import {
  toAccountId,
  toOrganizationAccessRequestId,
  toOrganizationId,
  toOrganizationInvitationId,
} from "../typed-id";
import { filterOrganizationMembers } from "./member-filter";
import { useBulkInviteModel } from "./use-bulk-invite-model";
import { usePersonalOrganizationConversion } from "./use-personal-organization-conversion";
import { useRequestAccessLink } from "./use-request-access-link";

export type { BulkInviteResult } from "./use-bulk-invite-model";

function memberError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

export function useMembersAccessModel({
  currentUserId,
  focusedMemberId,
  organization,
}: {
  currentUserId: string;
  focusedMemberId: string | null;
  organization: Organization;
}) {
  const { organizationCreationSlot, refreshOrganizations } = useAppSession();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [accessRequests, setAccessRequests] = useState<OrganizationAccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinPolicy, setJoinPolicy] = useState<OrganizationJoinPolicy>(organization.joinPolicy);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [cancellingInvitationId, setCancellingInvitationId] = useState<string | null>(null);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessSettingsOpen, setAccessSettingsOpen] = useState(false);
  const [primaryDomain, setPrimaryDomain] = useState(organization.primaryDomain ?? "");
  const [savingPrimaryDomain, setSavingPrimaryDomain] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const typedOrganizationId = toOrganizationId(organization.id);

  const currentMember = members.find((member) => member.accountId === currentUserId);
  const viewerRole = currentMember?.role ?? organization.viewerRole;
  const isPersonalOrganization = organization.kind === "personal";
  const canDirectInvite = !isPersonalOrganization && can(viewerRole, Permission.InvitationsCreate);
  const canRequestInvite =
    !isPersonalOrganization && !canDirectInvite && can(viewerRole, Permission.InvitationsRequest);
  const canInviteMembers = canDirectInvite || canRequestInvite;
  const canReviewAccess = can(viewerRole, Permission.AccessRequestsReview);
  const canOpenAccessSettings =
    can(viewerRole, Permission.OrgSetJoinPolicy) || can(viewerRole, Permission.OrgSetPrimaryDomain);
  const personalConversionSlotBlocked = organizationCreationSlot.occupied;
  const personalConversionBlockedReason =
    isPersonalOrganization && viewerRole === "owner" && personalConversionSlotBlocked
      ? "CE allows one organization you create. Delete your self-created organization or join another by invite instead."
      : null;
  const canConvertPersonalOrganization =
    isPersonalOrganization && viewerRole === "owner" && !personalConversionSlotBlocked;
  const attentionCount = invitations.length + accessRequests.length;
  const filteredMembers = useMemo(
    () => filterOrganizationMembers({ focusedMemberId, members, query: memberSearch }),
    [focusedMemberId, members, memberSearch],
  );
  const bulkInvite = useBulkInviteModel({
    canInviteMembers: canDirectInvite,
    organizationId: organization.id,
    setInvitations,
  });

  const loadAccessSurface = useCallback(async () => {
    setLoading(true);

    try {
      const nextMembers = await organizationMembers(typedOrganizationId);
      const nextViewerRole =
        nextMembers.find((member) => member.accountId === currentUserId)?.role ??
        organization.viewerRole;
      const [nextInvitations, nextRequests] =
        !isPersonalOrganization && can(nextViewerRole, Permission.InvitationsList)
          ? await Promise.all([
              organizationInvitations(typedOrganizationId),
              organizationAccessRequests(typedOrganizationId),
            ])
          : [[], []];

      setMembers(nextMembers);
      setInvitations(nextInvitations);
      setAccessRequests(nextRequests);
    } catch (nextError: unknown) {
      setError(memberError(nextError));
    } finally {
      setLoading(false);
    }
  }, [currentUserId, isPersonalOrganization, organization.viewerRole, typedOrganizationId]);

  const personalConversion = usePersonalOrganizationConversion({
    canConvertPersonalOrganization,
    conversionUnavailableMessage: personalConversionBlockedReason,
    loadAccessSurface,
    organizationId: organization.id,
    primaryDomain,
    refreshOrganizations,
    setError,
    setPrimaryDomain,
  });
  const requestAccessLinkState = useRequestAccessLink({
    organizationId: organization.id,
    setError,
  });

  useEffect(() => {
    setJoinPolicy(organization.joinPolicy);
    setPrimaryDomain(organization.primaryDomain ?? "");
  }, [organization.joinPolicy, organization.primaryDomain]);

  useEffect(() => {
    void loadAccessSurface();
  }, [loadAccessSurface]);

  useEffect(() => {
    function handleWindowFocus() {
      void loadAccessSurface();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void loadAccessSurface();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadAccessSurface]);

  async function handleRoleChange(userId: string, newRole: OrganizationMemberRole) {
    const targetRole = members.find((member) => member.accountId === userId)?.role;

    if (
      !targetRole ||
      !canUpdateOrganizationMemberRole({
        actorRole: viewerRole,
        nextRole: newRole,
        targetRole,
      })
    ) {
      setError("You do not have permission to perform this action.");
      return;
    }

    try {
      await updateMemberRole(typedOrganizationId, toAccountId(userId), newRole);
      setMembers((previous) =>
        previous.map((member) =>
          member.accountId === userId ? { ...member, role: newRole } : member,
        ),
      );
    } catch (nextError: unknown) {
      setError(memberError(nextError));
    }
  }

  async function handleRemove(userId: string) {
    const targetRole = members.find((member) => member.accountId === userId)?.role;

    if (
      !targetRole ||
      !canRemoveOrganizationMember({
        actorRole: viewerRole,
        targetRole,
      })
    ) {
      setError("You do not have permission to perform this action.");
      return;
    }

    try {
      await removeMember(typedOrganizationId, toAccountId(userId));
      setMembers((previous) => previous.filter((member) => member.accountId !== userId));
    } catch (nextError: unknown) {
      setError(memberError(nextError));
    }
  }

  async function handleInvite() {
    if (isPersonalOrganization) {
      setError("Convert this Personal Org to collaborate with others.");
      return;
    }

    if (!canInviteMembers) {
      setError("You do not have permission to perform this action.");
      return;
    }

    const trimmed = inviteEmail.trim();

    if (!trimmed) {
      return;
    }

    setInviting(true);
    setError(null);
    setInviteNotice(null);

    try {
      if (canDirectInvite) {
        const invitation = await inviteMember(typedOrganizationId, trimmed);
        setInvitations((previous) => [
          invitation,
          ...previous.filter((item) => item.id !== invitation.id),
        ]);
      } else {
        await requestOrganizationInvitation(typedOrganizationId, trimmed);
        setInviteNotice(`Invitation request submitted for admin review (${trimmed}).`);
      }
      setInviteEmail("");
      setShowInvite(false);
    } catch (nextError: unknown) {
      setError(memberError(nextError));
    } finally {
      setInviting(false);
    }
  }

  async function handlePolicyChange(policy: OrganizationJoinPolicy) {
    if (isPersonalOrganization) {
      setError("Convert this Personal Org to collaborate with others.");
      return;
    }

    if (!can(viewerRole, Permission.OrgSetJoinPolicy)) {
      setError("You do not have permission to perform this action.");
      return;
    }

    try {
      await updateJoinPolicy(typedOrganizationId, policy);
      setJoinPolicy(policy);
    } catch (nextError: unknown) {
      setError(memberError(nextError));
    }
  }

  async function handlePrimaryDomainSave() {
    if (!can(viewerRole, Permission.OrgSetPrimaryDomain)) {
      setError("You do not have permission to perform this action.");
      return;
    }

    if (isPersonalOrganization && primaryDomain.trim()) {
      if (personalConversionBlockedReason) {
        setError(personalConversionBlockedReason);
        return;
      }

      personalConversion.setConvertAndClaimOpen(true);
      return;
    }

    setSavingPrimaryDomain(true);
    setError(null);

    try {
      const nextOrganization = await updateOrganizationPrimaryDomain(
        typedOrganizationId,
        primaryDomain.trim() || null,
      );
      setPrimaryDomain(nextOrganization.primaryDomain ?? "");
    } catch (nextError: unknown) {
      setError(memberError(nextError));
    } finally {
      setSavingPrimaryDomain(false);
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!can(viewerRole, Permission.InvitationsCancel)) {
      setError("You do not have permission to perform this action.");
      return;
    }

    setCancellingInvitationId(invitationId);
    setError(null);

    try {
      await cancelOrganizationInvitation(toOrganizationInvitationId(invitationId));
      setInvitations((previous) => previous.filter((invitation) => invitation.id !== invitationId));
    } catch (nextError: unknown) {
      setError(memberError(nextError));
    } finally {
      setCancellingInvitationId(null);
    }
  }

  async function handleReviewRequest(requestId: string, decision: "approve" | "reject") {
    if (!canReviewAccess) {
      setError("You do not have permission to perform this action.");
      return;
    }

    setReviewingRequestId(requestId);
    setError(null);

    try {
      const reviewed = await reviewOrganizationAccessRequest(
        toOrganizationAccessRequestId(requestId),
        decision,
      );
      setAccessRequests((previous) => previous.filter((request) => request.id !== requestId));

      if (reviewed.status === "approved") {
        await loadAccessSurface();
      }
    } catch (nextError: unknown) {
      setError(memberError(nextError));
    } finally {
      setReviewingRequestId(null);
    }
  }

  return {
    accessRequests,
    accessSettingsOpen,
    attentionCount,
    attentionOpen,
    bulkDragOver: bulkInvite.bulkDragOver,
    bulkEmails: bulkInvite.bulkEmails,
    bulkError: bulkInvite.bulkError,
    bulkFileName: bulkInvite.bulkFileName,
    bulkInviting: bulkInvite.bulkInviting,
    bulkOpen: bulkInvite.bulkOpen,
    bulkParsing: bulkInvite.bulkParsing,
    bulkResult: bulkInvite.bulkResult,
    canConvertPersonalOrganization,
    canDirectInvite,
    canInviteMembers,
    canOpenAccessSettings,
    canRequestInvite,
    canReviewAccess,
    cancellingInvitationId,
    convertAndClaimOpen: personalConversion.convertAndClaimOpen,
    convertPersonalOpen: personalConversion.convertPersonalOpen,
    convertingPersonal: personalConversion.convertingPersonal,
    copied: requestAccessLinkState.copied,
    error,
    filteredMembers,
    handleBulkInvite: bulkInvite.handleBulkInvite,
    handleCancelInvitation,
    handleConvertAndClaimDomain: personalConversion.handleConvertAndClaimDomain,
    handleConvertPersonal: personalConversion.handleConvertPersonal,
    handleCopyLink: requestAccessLinkState.handleCopyLink,
    handleCsvFile: bulkInvite.handleCsvFile,
    handleInvite,
    handlePolicyChange,
    handlePrimaryDomainSave,
    handleRemove,
    handleReviewRequest,
    handleRoleChange,
    invitations,
    inviteEmail,
    inviteNotice,
    inviting,
    isPersonalOrganization,
    joinPolicy,
    loading,
    memberSearch,
    members,
    personalConversionBlockedReason,
    primaryDomain,
    requestAccessLink: requestAccessLinkState.requestAccessLink,
    resetBulk: bulkInvite.resetBulk,
    reviewingRequestId,
    savingConvertAndClaim: personalConversion.savingConvertAndClaim,
    savingPrimaryDomain,
    setAccessSettingsOpen,
    setAttentionOpen,
    setBulkDragOver: bulkInvite.setBulkDragOver,
    setBulkEmails: bulkInvite.setBulkEmails,
    setBulkOpen: bulkInvite.setBulkOpen,
    setConvertAndClaimOpen: personalConversion.setConvertAndClaimOpen,
    setConvertPersonalOpen: personalConversion.setConvertPersonalOpen,
    setInviteEmail,
    setInviteNotice,
    setMemberSearch,
    setPrimaryDomain,
    setShowInvite,
    showInvite,
    viewerRole,
  };
}
