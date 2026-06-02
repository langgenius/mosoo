import { AUDIT_ACTION, describeAuditAction } from "../../audit/domain/audit-vocabulary";
import type {
  AuditAction,
  AuditResourceType,
  AuditVerb,
} from "../../audit/domain/audit-vocabulary";

export type ControlOperationResourceLookupType = "agent" | "session";

export interface ControlOperationAuditIntent {
  readonly action: AuditAction;
  readonly organizationId?: string | null;
  readonly resourceId?: string | null;
  readonly resourceLookupType?: ControlOperationResourceLookupType | undefined;
  readonly resourceType: AuditResourceType;
  readonly verb: AuditVerb;
}

export interface ControlOperationAuditExclusion {
  readonly reason: string;
}

interface ControlOperationAuditIntentOptions {
  readonly organizationId?: string | null;
  readonly resourceId?: string | null;
  readonly resourceLookupType?: ControlOperationResourceLookupType | undefined;
}

function auditIntent(
  action: AuditAction,
  options: ControlOperationAuditIntentOptions = {},
): ControlOperationAuditIntent {
  return {
    ...options,
    ...describeAuditAction(action),
  };
}

const CONTROL_OPERATION_AUDIT_INTENTS: Readonly<Record<string, ControlOperationAuditIntent>> = {
  acceptOrganizationInvitation: auditIntent(AUDIT_ACTION.memberCreate),
  addSessionResource: auditIntent(AUDIT_ACTION.sessionUpdate, {
    resourceLookupType: "session",
  }),
  addAgentCollaborator: auditIntent(AUDIT_ACTION.agentShare),
  addCollaborator: auditIntent(AUDIT_ACTION.spaceShare),
  addOrganizationCollaborator: auditIntent(AUDIT_ACTION.spaceShare),
  archiveAgentSession: auditIntent(AUDIT_ACTION.sessionUpdate),
  autoTitleSession: auditIntent(AUDIT_ACTION.sessionUpdate),
  cancelOrganizationInvitation: auditIntent(AUDIT_ACTION.memberUnshare),
  clearOrganizationSharedCredential: auditIntent(AUDIT_ACTION.credentialDelete),
  connectMcpBearer: auditIntent(AUDIT_ACTION.credentialCreate),
  convertPersonalOrganization: auditIntent(AUDIT_ACTION.orgSettingsUpdate),
  createAgent: auditIntent(AUDIT_ACTION.agentCreate),
  createAgentFork: auditIntent(AUDIT_ACTION.agentFork),
  createAgentSession: auditIntent(AUDIT_ACTION.sessionCreate, {
    resourceLookupType: "agent",
  }),
  createDiscordAgentChannelBinding: auditIntent(AUDIT_ACTION.agentUpdate),
  createLarkAgentChannelBinding: auditIntent(AUDIT_ACTION.agentUpdate),
  createSlackAgentChannelBinding: auditIntent(AUDIT_ACTION.agentUpdate),
  createTelegramAgentChannelBinding: auditIntent(AUDIT_ACTION.agentUpdate),
  createEnvironment: auditIntent(AUDIT_ACTION.environmentCreate),
  createEnvironmentFork: auditIntent(AUDIT_ACTION.environmentFork),
  createOrganizationMcpServer: auditIntent(AUDIT_ACTION.mcpBindingCreate),
  createPersonalMcpServer: auditIntent(AUDIT_ACTION.mcpBindingCreate),
  createSkillFork: auditIntent(AUDIT_ACTION.skillFork),
  createSpace: auditIntent(AUDIT_ACTION.spaceCreate),
  createSpaceDirectory: auditIntent(AUDIT_ACTION.spaceUpdate),
  createVendorCredential: auditIntent(AUDIT_ACTION.credentialCreate),
  deleteAgent: auditIntent(AUDIT_ACTION.agentDelete),
  deleteAgentChannelBinding: auditIntent(AUDIT_ACTION.agentUpdate),
  deleteAgentSession: auditIntent(AUDIT_ACTION.sessionDelete),
  deleteEnvironment: auditIntent(AUDIT_ACTION.environmentDelete),
  deleteMcpServer: auditIntent(AUDIT_ACTION.mcpBindingDelete),
  deleteOwnedSkill: auditIntent(AUDIT_ACTION.skillDelete),
  deleteSpace: auditIntent(AUDIT_ACTION.spaceDelete),
  deleteSpaceEntry: auditIntent(AUDIT_ACTION.spaceUpdate),
  deleteVendorCredential: auditIntent(AUDIT_ACTION.credentialDelete),
  exportAgentPackage: auditIntent(AUDIT_ACTION.agentExport),
  importAgentPackage: auditIntent(AUDIT_ACTION.agentCreate),
  inviteOrganizationMember: auditIntent(AUDIT_ACTION.memberShare),
  // Query intents are appended only for denied/failure outcomes by the GraphQL wrapper.
  listSessionResources: auditIntent(AUDIT_ACTION.sessionUpdate, {
    resourceLookupType: "session",
  }),
  pollLarkAgentChannelRegistration: auditIntent(AUDIT_ACTION.agentUpdate),
  pollWeChatAgentChannelPairing: auditIntent(AUDIT_ACTION.agentUpdate),
  publishAgent: auditIntent(AUDIT_ACTION.agentPublish),
  recreateSandbox: auditIntent(AUDIT_ACTION.agentUpdate),
  removeAgentCollaborator: auditIntent(AUDIT_ACTION.agentUnshare),
  removeCollaborator: auditIntent(AUDIT_ACTION.spaceUnshare),
  removeOrganizationMember: auditIntent(AUDIT_ACTION.memberDelete),
  removeSessionResource: auditIntent(AUDIT_ACTION.sessionUpdate, {
    resourceLookupType: "session",
  }),
  renameSession: auditIntent(AUDIT_ACTION.sessionUpdate),
  requestOrganizationAccess: auditIntent(AUDIT_ACTION.memberShare),
  requestOrganizationInvitation: auditIntent(AUDIT_ACTION.memberShare),
  resetAgentState: auditIntent(AUDIT_ACTION.agentUpdate),
  restartDriver: auditIntent(AUDIT_ACTION.agentUpdate),
  reviewOrganizationAccessRequest: auditIntent(AUDIT_ACTION.memberCreate),
  revokeMcpUserCredential: auditIntent(AUDIT_ACTION.credentialDelete),
  setEnvironmentVariableValue: auditIntent(AUDIT_ACTION.environmentUpdate),
  setMcpServerEnabled: auditIntent(AUDIT_ACTION.mcpBindingUpdate),
  setOrganizationDefaultEnvironment: auditIntent(AUDIT_ACTION.environmentUpdate),
  setOrganizationMemberStatus: auditIntent(AUDIT_ACTION.memberUpdate),
  setOrganizationSharedBearer: auditIntent(AUDIT_ACTION.credentialCreate),
  setSystemAgentModel: auditIntent(AUDIT_ACTION.orgSettingsUpdate),
  sendAgentSessionEvents: auditIntent(AUDIT_ACTION.sessionUpdate, {
    resourceLookupType: "session",
  }),
  sessionMessages: auditIntent(AUDIT_ACTION.sessionUpdate, {
    resourceLookupType: "session",
  }),
  sessionProcessEvents: auditIntent(AUDIT_ACTION.sessionUpdate, {
    resourceLookupType: "session",
  }),
  shareEnvironmentWithOrganization: auditIntent(AUDIT_ACTION.environmentShare),
  shareEnvironmentWithUser: auditIntent(AUDIT_ACTION.environmentShare),
  shareSkillWithOrganization: auditIntent(AUDIT_ACTION.skillShare),
  shareSkillWithUser: auditIntent(AUDIT_ACTION.skillShare),
  startLarkAgentChannelRegistration: auditIntent(AUDIT_ACTION.agentUpdate),
  startMcpOAuth: auditIntent(AUDIT_ACTION.credentialCreate),
  startWeChatAgentChannelPairing: auditIntent(AUDIT_ACTION.agentUpdate),
  testVendorCredential: auditIntent(AUDIT_ACTION.credentialUpdate),
  threadSessionMessages: auditIntent(AUDIT_ACTION.sessionUpdate, {
    resourceLookupType: "session",
  }),
  threadSessionProcessEvents: auditIntent(AUDIT_ACTION.sessionUpdate, {
    resourceLookupType: "session",
  }),
  unarchiveAgentSession: auditIntent(AUDIT_ACTION.sessionUpdate),
  unpublishAgent: auditIntent(AUDIT_ACTION.agentUnpublish),
  unshareEnvironmentTarget: auditIntent(AUDIT_ACTION.environmentUnshare),
  unshareSkillTarget: auditIntent(AUDIT_ACTION.skillUnshare),
  updateAgentCollaborator: auditIntent(AUDIT_ACTION.agentUpdate),
  updateAgentConfig: auditIntent(AUDIT_ACTION.agentUpdate),
  updateAgentPackageSharing: auditIntent(AUDIT_ACTION.agentUpdate),
  updateCollaborator: auditIntent(AUDIT_ACTION.spaceUpdate),
  updateCredentialPolicy: auditIntent(AUDIT_ACTION.orgSettingsUpdate),
  updateEnvironment: auditIntent(AUDIT_ACTION.environmentUpdate),
  updateOrganizationJoinPolicy: auditIntent(AUDIT_ACTION.orgSettingsUpdate),
  updateOrganizationMemberRole: auditIntent(AUDIT_ACTION.memberUpdate),
  updateOrganizationPrimaryDomain: auditIntent(AUDIT_ACTION.orgSettingsUpdate),
  updateOrganizationProfile: auditIntent(AUDIT_ACTION.orgSettingsUpdate),
  updateSpace: auditIntent(AUDIT_ACTION.spaceUpdate),
  updateVendorCredential: auditIntent(AUDIT_ACTION.credentialUpdate),
};

const CONTROL_OPERATION_AUDIT_EXCLUSIONS: Readonly<Record<string, ControlOperationAuditExclusion>> =
  {
    createOrganization: {
      reason:
        "Organization creation can happen before an organization-scoped audit resource exists.",
    },
    ensureAgentBuilderThread: {
      reason: "Builder thread creation is agent-local conversation state, not an audit event.",
    },
    onboardingBootstrap: {
      reason: "Onboarding bootstrap can run before an organization-scoped audit resource exists.",
    },
    prewarmAgentSession: {
      reason:
        "Runtime prewarm is a transient performance hint — fire-and-forget, idempotent, and emits no domain-meaningful state change.",
    },
    setActiveOrganization: {
      reason: "Active organization selection is an account preference, not an organization event.",
    },
    setSkillAutoEnabled: {
      reason:
        "Skill auto-enable is a per-user runtime preference, not an organization audit event.",
    },
    updateSessionThreadUiState: {
      reason: "Thread read and pin state is per-user UI state, not an organization audit event.",
    },
    updateProfile: {
      reason: "Profile updates are account-local user metadata, not organization audit events.",
    },
  };

export function getControlOperationAuditIntent(
  operationName: string,
): ControlOperationAuditIntent | null {
  return CONTROL_OPERATION_AUDIT_INTENTS[operationName] ?? null;
}

function getControlOperationAuditExclusion(
  operationName: string,
): ControlOperationAuditExclusion | null {
  return CONTROL_OPERATION_AUDIT_EXCLUSIONS[operationName] ?? null;
}

export function isKnownControlOperationOutcomePolicy(operationName: string): boolean {
  return (
    getControlOperationAuditIntent(operationName) !== null ||
    getControlOperationAuditExclusion(operationName) !== null
  );
}

export function shouldAuditControlOperationOutcome(operationName: string): boolean {
  return getControlOperationAuditIntent(operationName) !== null;
}
