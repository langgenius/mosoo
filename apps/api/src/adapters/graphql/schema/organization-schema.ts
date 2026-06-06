export const organizationSchema = /* GraphQL */ `
  type Organization {
    avatarUrl: String
    createdAt: String!
    id: ULID!
    joinPolicy: OrganizationJoinPolicy!
    name: String!
    primaryDomain: String
    slug: String!
    viewerRole: OrganizationMemberRole
  }

  type OrganizationMember {
    accountId: ULID!
    disabledAt: String
    disabledByAccountId: ULID
    email: String!
    imageUrl: String
    joinedAt: String!
    name: String!
    role: OrganizationMemberRole!
    status: OrganizationMemberStatus!
  }

  type OrganizationInvitation {
    createdAt: String!
    email: String!
    expiresAt: String
    id: ULID!
    invitedBy: ULID!
    invitedByName: String
    organizationId: ULID!
    organizationName: String!
    status: OrganizationInvitationStatus!
    updatedAt: String!
    accountId: ULID
  }

  type OrganizationAccessRequest {
    createdAt: String!
    id: ULID!
    organizationId: ULID!
    organizationName: String!
    referrerAccountId: ULID
    referrerName: String
    requestedByAccountId: ULID!
    requesterEmail: String!
    requesterName: String!
    reviewedAt: String
    reviewedBy: ULID
    reviewedByName: String
    status: OrganizationAccessRequestStatus!
    updatedAt: String!
  }

  type OrganizationJoinTarget {
    organizationId: ULID!
    organizationName: String!
    pendingInvitation: OrganizationInvitation
    pendingRequest: OrganizationAccessRequest
    viewerIsAuthenticated: Boolean!
    viewerIsMember: Boolean!
    organization: Organization!
  }

  enum OrganizationJoinPolicy {
    auto
    invite_only
  }

  enum OrganizationMemberRole {
    owner
    admin
    member
  }

  enum OrganizationMemberStatus {
    active
    disabled
  }

  enum OrganizationInvitationStatus {
    accepted
    cancelled
    expired
    pending
    rejected
  }

  enum OrganizationAccessRequestStatus {
    approved
    cancelled
    pending
    rejected
  }

  input UpdateOrganizationMemberRoleInput {
    accountId: ULID!
    role: OrganizationMemberRole!
    organizationId: ULID!
  }

  input RemoveOrganizationMemberInput {
    accountId: ULID!
    organizationId: ULID!
  }

  input SetOrganizationMemberStatusInput {
    accountId: ULID!
    organizationId: ULID!
    status: OrganizationMemberStatus!
  }

  input InviteOrganizationMemberInput {
    email: String!
    organizationId: ULID!
  }

  input AcceptOrganizationInvitationInput {
    invitationId: ULID!
  }

  input CancelOrganizationInvitationInput {
    invitationId: ULID!
  }

  input CreateOrganizationInput {
    name: String
  }

  input SetActiveOrganizationInput {
    organizationId: ULID!
  }

  input RequestOrganizationAccessInput {
    organizationId: ULID!
  }

  input RequestOrganizationInvitationInput {
    email: String!
    organizationId: ULID!
  }

  input ReviewOrganizationAccessRequestInput {
    decision: OrganizationAccessRequestDecision!
    requestId: ULID!
  }

  input UpdateOrganizationJoinPolicyInput {
    joinPolicy: OrganizationJoinPolicy!
    organizationId: ULID!
  }

  input UpdateOrganizationPrimaryDomainInput {
    domain: String
    organizationId: ULID!
  }

  input UpdateOrganizationProfileInput {
    avatarUrl: String
    name: String
    organizationId: ULID!
  }

  enum OrganizationAccessRequestDecision {
    approve
    reject
  }
`;
