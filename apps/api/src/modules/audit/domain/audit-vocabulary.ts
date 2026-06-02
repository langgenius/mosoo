import type { AuditVerb } from "@mosoo/db";

export type { AuditVerb };

export const AUDIT_RESOURCE = {
  agent: "agent",
  auditLog: "audit_log",
  apiKey: "api_key",
  credential: "credential",
  environment: "environment",
  mcpBinding: "mcp_binding",
  member: "member",
  orgSettings: "org_settings",
  session: "session",
  skill: "skill",
  space: "space",
} as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE)[keyof typeof AUDIT_RESOURCE];

export const AUDIT_OUTCOME = {
  denied: "denied",
  failure: "failure",
  success: "success",
} as const;

export type AuditOutcome = (typeof AUDIT_OUTCOME)[keyof typeof AUDIT_OUTCOME];

export const AUDIT_OUTCOMES = Object.values(AUDIT_OUTCOME);

const AUDIT_OUTCOME_SET: ReadonlySet<string> = new Set(AUDIT_OUTCOMES);

export function isAuditOutcome(value: string): value is AuditOutcome {
  return AUDIT_OUTCOME_SET.has(value);
}

export const AUDIT_VERB = {
  create: "create",
  delete: "delete",
  export: "export",
  fork: "fork",
  login: "login",
  logout: "logout",
  publish: "publish",
  share: "share",
  unpublish: "unpublish",
  unshare: "unshare",
  update: "update",
} as const satisfies Record<AuditVerb, AuditVerb>;

function formatAuditAction<TResource extends AuditResourceType, TVerb extends AuditVerb>(
  resourceType: TResource,
  verb: TVerb,
): `${TResource}.${TVerb}` {
  return `${resourceType}.${verb}`;
}

export const AUDIT_ACTION = {
  agentCreate: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.create),
  agentDelete: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.delete),
  agentExport: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.export),
  agentFork: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.fork),
  agentPublish: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.publish),
  agentShare: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.share),
  agentUnpublish: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.unpublish),
  agentUnshare: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.unshare),
  agentUpdate: formatAuditAction(AUDIT_RESOURCE.agent, AUDIT_VERB.update),
  auditLogExport: formatAuditAction(AUDIT_RESOURCE.auditLog, AUDIT_VERB.export),
  apiKeyCreate: formatAuditAction(AUDIT_RESOURCE.apiKey, AUDIT_VERB.create),
  apiKeyDelete: formatAuditAction(AUDIT_RESOURCE.apiKey, AUDIT_VERB.delete),
  credentialCreate: formatAuditAction(AUDIT_RESOURCE.credential, AUDIT_VERB.create),
  credentialDelete: formatAuditAction(AUDIT_RESOURCE.credential, AUDIT_VERB.delete),
  credentialUpdate: formatAuditAction(AUDIT_RESOURCE.credential, AUDIT_VERB.update),
  environmentCreate: formatAuditAction(AUDIT_RESOURCE.environment, AUDIT_VERB.create),
  environmentDelete: formatAuditAction(AUDIT_RESOURCE.environment, AUDIT_VERB.delete),
  environmentFork: formatAuditAction(AUDIT_RESOURCE.environment, AUDIT_VERB.fork),
  environmentShare: formatAuditAction(AUDIT_RESOURCE.environment, AUDIT_VERB.share),
  environmentUnshare: formatAuditAction(AUDIT_RESOURCE.environment, AUDIT_VERB.unshare),
  environmentUpdate: formatAuditAction(AUDIT_RESOURCE.environment, AUDIT_VERB.update),
  mcpBindingCreate: formatAuditAction(AUDIT_RESOURCE.mcpBinding, AUDIT_VERB.create),
  mcpBindingDelete: formatAuditAction(AUDIT_RESOURCE.mcpBinding, AUDIT_VERB.delete),
  mcpBindingUpdate: formatAuditAction(AUDIT_RESOURCE.mcpBinding, AUDIT_VERB.update),
  memberCreate: formatAuditAction(AUDIT_RESOURCE.member, AUDIT_VERB.create),
  memberDelete: formatAuditAction(AUDIT_RESOURCE.member, AUDIT_VERB.delete),
  memberShare: formatAuditAction(AUDIT_RESOURCE.member, AUDIT_VERB.share),
  memberUnshare: formatAuditAction(AUDIT_RESOURCE.member, AUDIT_VERB.unshare),
  memberUpdate: formatAuditAction(AUDIT_RESOURCE.member, AUDIT_VERB.update),
  orgSettingsUpdate: formatAuditAction(AUDIT_RESOURCE.orgSettings, AUDIT_VERB.update),
  sessionCreate: formatAuditAction(AUDIT_RESOURCE.session, AUDIT_VERB.create),
  sessionDelete: formatAuditAction(AUDIT_RESOURCE.session, AUDIT_VERB.delete),
  sessionUpdate: formatAuditAction(AUDIT_RESOURCE.session, AUDIT_VERB.update),
  skillDelete: formatAuditAction(AUDIT_RESOURCE.skill, AUDIT_VERB.delete),
  skillFork: formatAuditAction(AUDIT_RESOURCE.skill, AUDIT_VERB.fork),
  skillShare: formatAuditAction(AUDIT_RESOURCE.skill, AUDIT_VERB.share),
  skillUnshare: formatAuditAction(AUDIT_RESOURCE.skill, AUDIT_VERB.unshare),
  spaceCreate: formatAuditAction(AUDIT_RESOURCE.space, AUDIT_VERB.create),
  spaceDelete: formatAuditAction(AUDIT_RESOURCE.space, AUDIT_VERB.delete),
  spaceShare: formatAuditAction(AUDIT_RESOURCE.space, AUDIT_VERB.share),
  spaceUnshare: formatAuditAction(AUDIT_RESOURCE.space, AUDIT_VERB.unshare),
  spaceUpdate: formatAuditAction(AUDIT_RESOURCE.space, AUDIT_VERB.update),
} as const satisfies Record<string, `${AuditResourceType}.${AuditVerb}`>;

export type AuditAction = `${AuditResourceType}.${AuditVerb}`;

export function createAuditAction(resourceType: AuditResourceType, verb: AuditVerb): AuditAction {
  return formatAuditAction(resourceType, verb);
}

export function describeAuditAction(action: AuditAction): {
  action: AuditAction;
  resourceType: AuditResourceType;
  verb: AuditVerb;
} {
  const separatorIndex = action.indexOf(".");
  return {
    action,
    resourceType: action.slice(0, separatorIndex) as AuditResourceType,
    verb: action.slice(separatorIndex + 1) as AuditVerb,
  };
}
