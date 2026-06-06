import type { AccountId, OrganizationId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { organizationGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  listOrganizationAccessRequests,
  requestOrganizationAccess,
  requestOrganizationInvitation,
  reviewOrganizationAccessRequest,
} from "../application/organization-access-requests.service";
import {
  acceptOrganizationInvitation,
  cancelOrganizationInvitation,
  inviteOrganizationMember,
  listOrganizationInvitations,
  listPendingOrganizationInvitations,
} from "../application/organization-invitations.service";
import { getOrganizationJoinTarget } from "../application/organization-join-target.service";
import { removeOrganizationMember } from "../application/organization-member-removal.service";
import {
  listOrganizationMembers,
  setOrganizationMemberStatus,
  updateJoinPolicy,
  updateOrganizationMemberRole,
} from "../application/organization-members.service";
import {
  createOrganization,
  setActiveOrganization,
  updateOrganizationPrimaryDomain,
  updateOrganizationProfile,
} from "../application/organization.service";

interface OrganizationIdArgs {
  organizationId: OrganizationId;
}

interface UpdateOrganizationMemberRoleArgs {
  input: Parameters<typeof updateOrganizationMemberRole>[2];
}

interface RemoveOrganizationMemberArgs {
  input: {
    accountId: AccountId;
    organizationId: OrganizationId;
  };
}

interface SetOrganizationMemberStatusArgs {
  input: Parameters<typeof setOrganizationMemberStatus>[2];
}

interface InviteOrganizationMemberArgs {
  input: {
    email: string;
    organizationId: OrganizationId;
  };
}

interface AcceptOrganizationInvitationArgs {
  input: Parameters<typeof acceptOrganizationInvitation>[2];
}

interface CancelOrganizationInvitationArgs {
  input: Parameters<typeof cancelOrganizationInvitation>[2];
}

interface CreateOrganizationArgs {
  input: Parameters<typeof createOrganization>[2];
}

interface SetActiveOrganizationArgs {
  input: Parameters<typeof setActiveOrganization>[2];
}

interface RequestOrganizationAccessArgs {
  input: Parameters<typeof requestOrganizationAccess>[2];
}

interface RequestOrganizationInvitationArgs {
  input: Parameters<typeof requestOrganizationInvitation>[2];
}

interface ReviewOrganizationAccessRequestArgs {
  input: Parameters<typeof reviewOrganizationAccessRequest>[2];
}

interface UpdateOrganizationJoinPolicyArgs {
  input: Parameters<typeof updateJoinPolicy>[2];
}

interface UpdateOrganizationPrimaryDomainArgs {
  input: Parameters<typeof updateOrganizationPrimaryDomain>[2];
}

interface UpdateOrganizationProfileArgs {
  input: Parameters<typeof updateOrganizationProfile>[2];
}

export const organizationGraphQLModule = {
  ...organizationGraphQLSpec,
  authenticatedMutationResolvers: {
    acceptOrganizationInvitation: async (
      _parent,
      args: AcceptOrganizationInvitationArgs,
      context,
    ) => acceptOrganizationInvitation(context.bindings.DB, context.viewer, args.input),
    cancelOrganizationInvitation: async (
      _parent,
      args: CancelOrganizationInvitationArgs,
      context,
    ) => cancelOrganizationInvitation(context.bindings.DB, context.viewer, args.input),
    createOrganization: async (_parent, args: CreateOrganizationArgs, context) =>
      createOrganization(context.bindings.DB, context.viewer, args.input),
    inviteOrganizationMember: async (_parent, args: InviteOrganizationMemberArgs, context) =>
      inviteOrganizationMember(
        context.bindings,
        context.viewer,
        args.input.email,
        args.input.organizationId,
      ),
    removeOrganizationMember: async (_parent, args: RemoveOrganizationMemberArgs, context) => {
      await removeOrganizationMember(
        context.bindings,
        context.viewer,
        args.input.organizationId,
        args.input.accountId,
      );
      return { ok: true } as const;
    },
    requestOrganizationAccess: async (_parent, args: RequestOrganizationAccessArgs, context) =>
      requestOrganizationAccess(context.bindings.DB, context.viewer, args.input),
    requestOrganizationInvitation: async (
      _parent,
      args: RequestOrganizationInvitationArgs,
      context,
    ) => requestOrganizationInvitation(context.bindings.DB, context.viewer, args.input),
    reviewOrganizationAccessRequest: async (
      _parent,
      args: ReviewOrganizationAccessRequestArgs,
      context,
    ) => reviewOrganizationAccessRequest(context.bindings, context.viewer, args.input),
    setActiveOrganization: async (_parent, args: SetActiveOrganizationArgs, context) =>
      setActiveOrganization(context.bindings.DB, context.viewer, args.input),
    setOrganizationMemberStatus: async (_parent, args: SetOrganizationMemberStatusArgs, context) =>
      setOrganizationMemberStatus(context.bindings.DB, context.viewer, args.input),
    updateOrganizationJoinPolicy: async (
      _parent,
      args: UpdateOrganizationJoinPolicyArgs,
      context,
    ) => updateJoinPolicy(context.bindings.DB, context.viewer, args.input),
    updateOrganizationMemberRole: async (
      _parent,
      args: UpdateOrganizationMemberRoleArgs,
      context,
    ) => updateOrganizationMemberRole(context.bindings.DB, context.viewer, args.input),
    updateOrganizationPrimaryDomain: async (
      _parent,
      args: UpdateOrganizationPrimaryDomainArgs,
      context,
    ) => updateOrganizationPrimaryDomain(context.bindings.DB, context.viewer, args.input),
    updateOrganizationProfile: async (_parent, args: UpdateOrganizationProfileArgs, context) =>
      updateOrganizationProfile(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    organizationAccessRequestList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationAccessRequests(context.bindings.DB, context.viewer, args.organizationId),
    organizationInvitationList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationInvitations(context.bindings.DB, context.viewer, args.organizationId),
    organizationJoinTarget: async (_parent, args: OrganizationIdArgs, context) =>
      getOrganizationJoinTarget(context.bindings.DB, context.viewer, args.organizationId),
    organizationMemberList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationMembers(context.bindings.DB, context.viewer, args.organizationId),
    pendingOrganizationInvitationList: async (_parent, _args, context) =>
      listPendingOrganizationInvitations(context.bindings.DB, context.viewer),
  },
} satisfies GraphQLModule;
