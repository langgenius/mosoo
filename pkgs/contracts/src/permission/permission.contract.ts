import type { OrganizationMemberRole } from "../organization/organization.contract";

export const Permission = {
  AccessRequestsList: "access-requests.list",
  AccessRequestsReview: "access-requests.review",
  AgentsAclList: "agents.acl.list",
  AgentsAclUpdate: "agents.acl.update",
  AgentsCreate: "agents.create",
  AgentsDelete: "agents.delete",
  AgentsGet: "agents.get",
  AgentsGetEditorState: "agents.get-editor-state",
  AgentsListAll: "agents.list-all",
  AgentsListVisible: "agents.list-visible",
  AgentsPublish: "agents.publish",
  AgentsUpdateBasics: "agents.update-basics",
  AgentsUpdateEnvironment: "agents.update-environment",
  CostOrganizationExport: "cost.organization.export",
  CostOrganizationRead: "cost.organization.overview",
  EnvironmentsCreate: "environments.create",
  EnvironmentsDelete: "environments.delete",
  EnvironmentsFork: "environments.fork",
  EnvironmentsGet: "environments.get",
  EnvironmentsListAll: "environments.list-all",
  EnvironmentsListVisible: "environments.list-visible",
  EnvironmentsSetOrgDefault: "environments.set-org-default",
  EnvironmentsShare: "environments.share.user",
  EnvironmentsUpdate: "environments.update",
  InvitationsCancel: "invitations.cancel",
  InvitationsCreate: "invitations.create",
  InvitationsList: "invitations.list",
  InvitationsRequest: "invitations.request",
  McpOrganizationManage: "mcp.organization.create",
  McpPersonalCreate: "mcp.personal.create",
  MembersDisable: "members.disable",
  MembersEnable: "members.enable",
  MembersList: "members.list",
  MembersRemove: "members.remove",
  MembersSetRole: "members.set-role",
  OrgSetJoinPolicy: "org.set-join-policy",
  OrgSetPrimaryDomain: "org.set-primary-domain",
  OrgUpdateProfile: "org.update-profile",
  ProvidersCompanyManage: "providers.company.create",
  SkillsListOrganization: "skills.list-organization",
  SpacesAclList: "spaces.acl.list",
  SpacesAclUpdate: "spaces.acl.update",
  SpacesCreate: "spaces.create",
  SpacesDelete: "spaces.delete",
  SpacesDeleteEntry: "spaces.delete-entry",
  SpacesGet: "spaces.get",
  SpacesListVisible: "spaces.list-visible",
  SpacesReadFiles: "spaces.read-files",
  SpacesUpdateSettings: "spaces.update-settings",
  SpacesWriteFiles: "spaces.write-files",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

const ROLE_PERMISSIONS = {
  admin: [
    Permission.AccessRequestsList,
    Permission.AccessRequestsReview,
    Permission.AgentsAclList,
    Permission.AgentsAclUpdate,
    Permission.AgentsCreate,
    Permission.AgentsDelete,
    Permission.AgentsGet,
    Permission.AgentsGetEditorState,
    Permission.AgentsListAll,
    Permission.AgentsListVisible,
    Permission.AgentsPublish,
    Permission.AgentsUpdateBasics,
    Permission.AgentsUpdateEnvironment,
    Permission.InvitationsCancel,
    Permission.InvitationsCreate,
    Permission.InvitationsList,
    Permission.CostOrganizationExport,
    Permission.CostOrganizationRead,
    Permission.EnvironmentsCreate,
    Permission.EnvironmentsDelete,
    Permission.EnvironmentsFork,
    Permission.EnvironmentsGet,
    Permission.EnvironmentsListAll,
    Permission.EnvironmentsListVisible,
    Permission.EnvironmentsSetOrgDefault,
    Permission.EnvironmentsShare,
    Permission.EnvironmentsUpdate,
    Permission.McpPersonalCreate,
    Permission.McpOrganizationManage,
    Permission.MembersList,
    Permission.MembersDisable,
    Permission.MembersEnable,
    Permission.MembersRemove,
    Permission.ProvidersCompanyManage,
    Permission.SkillsListOrganization,
    Permission.SpacesAclList,
    Permission.SpacesAclUpdate,
    Permission.SpacesCreate,
    Permission.SpacesDelete,
    Permission.SpacesDeleteEntry,
    Permission.SpacesGet,
    Permission.SpacesListVisible,
    Permission.SpacesReadFiles,
    Permission.SpacesUpdateSettings,
    Permission.SpacesWriteFiles,
  ],
  member: [
    Permission.AgentsCreate,
    Permission.AgentsListVisible,
    Permission.EnvironmentsCreate,
    Permission.EnvironmentsFork,
    Permission.EnvironmentsGet,
    Permission.EnvironmentsListVisible,
    Permission.InvitationsRequest,
    Permission.McpPersonalCreate,
    Permission.MembersList,
    Permission.SkillsListOrganization,
    Permission.SpacesCreate,
    Permission.SpacesListVisible,
  ],
  owner: [
    Permission.AccessRequestsList,
    Permission.AccessRequestsReview,
    Permission.AgentsAclList,
    Permission.AgentsAclUpdate,
    Permission.AgentsCreate,
    Permission.AgentsDelete,
    Permission.AgentsGet,
    Permission.AgentsGetEditorState,
    Permission.AgentsListAll,
    Permission.AgentsListVisible,
    Permission.AgentsPublish,
    Permission.AgentsUpdateBasics,
    Permission.AgentsUpdateEnvironment,
    Permission.InvitationsCancel,
    Permission.InvitationsCreate,
    Permission.InvitationsList,
    Permission.CostOrganizationExport,
    Permission.CostOrganizationRead,
    Permission.EnvironmentsCreate,
    Permission.EnvironmentsDelete,
    Permission.EnvironmentsFork,
    Permission.EnvironmentsGet,
    Permission.EnvironmentsListAll,
    Permission.EnvironmentsListVisible,
    Permission.EnvironmentsSetOrgDefault,
    Permission.EnvironmentsShare,
    Permission.EnvironmentsUpdate,
    Permission.McpPersonalCreate,
    Permission.McpOrganizationManage,
    Permission.MembersList,
    Permission.MembersDisable,
    Permission.MembersEnable,
    Permission.MembersRemove,
    Permission.MembersSetRole,
    Permission.OrgSetJoinPolicy,
    Permission.OrgSetPrimaryDomain,
    Permission.OrgUpdateProfile,
    Permission.ProvidersCompanyManage,
    Permission.SkillsListOrganization,
    Permission.SpacesAclList,
    Permission.SpacesAclUpdate,
    Permission.SpacesCreate,
    Permission.SpacesDelete,
    Permission.SpacesDeleteEntry,
    Permission.SpacesGet,
    Permission.SpacesListVisible,
    Permission.SpacesReadFiles,
    Permission.SpacesUpdateSettings,
    Permission.SpacesWriteFiles,
  ],
} as const satisfies Record<OrganizationMemberRole, readonly Permission[]>;

export function can(
  role: OrganizationMemberRole | null | undefined,
  permission: Permission,
): boolean {
  return (
    role !== null &&
    role !== undefined &&
    (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission)
  );
}

export function canUpdateOrganizationMemberRole(input: {
  actorRole: OrganizationMemberRole | null | undefined;
  nextRole: OrganizationMemberRole;
  targetRole: OrganizationMemberRole;
}): boolean {
  return (
    can(input.actorRole, Permission.MembersSetRole) &&
    input.targetRole !== "owner" &&
    input.nextRole !== "owner"
  );
}

export function canRemoveOrganizationMember(input: {
  actorRole: OrganizationMemberRole | null | undefined;
  targetRole: OrganizationMemberRole;
}): boolean {
  if (input.actorRole === "owner") {
    return input.targetRole !== "owner";
  }

  if (input.actorRole === "admin") {
    return input.targetRole === "member";
  }

  return false;
}
