import {
  FILE_OWNER_KINDS,
  FILE_PURPOSES,
  FILE_SCOPE_KINDS,
  FILE_UPLOAD_STATUSES,
  FILE_UPLOAD_STRATEGIES,
} from "@mosoo/contracts/file";
import {
  AGENT_SESSION_ACTION_CAPABILITY_NAMES,
  AGENT_SESSION_ACTION_CAPABILITY_STATUSES,
  AGENT_SESSION_EVENT_TYPES,
  AGENT_SESSION_PERMISSION_DECISIONS,
  AGENT_SESSION_RECOVERABILITY_STATUSES,
  SESSION_PROCESS_EVENT_STATUSES,
  SESSION_PROCESS_EVENT_TYPE_CODES,
  SESSION_STATUSES,
  SESSION_TYPES,
} from "@mosoo/contracts/session";

import { graphQLEnumValues } from "./graphql-enum-values";

export const sessionSchema = /* GraphQL */ `
  enum SessionMessageRole {
    assistant
    user
  }

  enum SessionMessageSegmentKind {
    text
    tool_result
    tool_use
  }

  enum SessionMessagePlanPriority {
    high
    medium
    low
  }

  enum SessionMessagePlanStatus {
    pending
    in_progress
    completed
  }

  type SessionMessageSegment {
    argsText: String
    kind: SessionMessageSegmentKind!
    output: String
    path: String
    text: String
    tool: String
    toolCallId: String
  }

  type SessionMessagePlanEntry {
    content: String!
    priority: SessionMessagePlanPriority!
    status: SessionMessagePlanStatus!
  }

  type SessionMessage {
    content: String!
    createdAt: String!
    createdBy: ULID!
    id: ULID!
    plan: [SessionMessagePlanEntry!]!
    role: SessionMessageRole!
    segments: [SessionMessageSegment!]!
  }

  enum SessionProcessEventStatus {
    ${graphQLEnumValues(SESSION_PROCESS_EVENT_STATUSES)}
  }

  enum SessionProcessEventType {
    ${graphQLEnumValues(Object.values(SESSION_PROCESS_EVENT_TYPE_CODES))}
  }

  type SessionProcessEvent {
    content: String!
    durationMs: Int
    id: ULID!
    occurredAt: String!
    status: SessionProcessEventStatus!
    tokens: Int
    type: SessionProcessEventType!
  }

  type SessionListPageInfo {
    endCursor: String
    hasMore: Boolean!
    startCursor: String
  }

  type SessionConnection {
    nodes: [Session!]!
    pageInfo: SessionListPageInfo!
  }

  type SessionThreadUiState {
    pinned: Boolean!
    readAt: String
    sessionId: ULID!
    updatedAt: String!
  }

  input UpdateSessionThreadUiStateInput {
    pinned: Boolean
    readAt: String
    sessionId: ULID!
  }

  enum SessionType {
    ${graphQLEnumValues(SESSION_TYPES)}
  }

  type Session {
    agentId: ULID!
    archivedAt: String
    createdAt: String!
    deploymentVersionId: ULID
    deploymentVersionNumber: Int
    id: ULID!
    kind: AgentKind!
    lastMessageAt: String
    lastRun: SessionRun
    model: String!
    provider: String!
    runtimeId: String!
    status: SessionStatus!
    title: String
    type: SessionType!
    updatedAt: String!
    organizationId: ULID!
  }

  type SessionRun {
    completedAt: String
    createdAt: String!
    deploymentVersionId: ULID
    deploymentVersionNumber: Int
    error: RunError
    id: ULID!
    model: String
    provider: String
    startedAt: String
    status: RunStatus!
    traceId: String!
    trigger: SessionRunTrigger!
    updatedAt: String!
  }

  enum AgentSessionEventType {
    ${graphQLEnumValues(AGENT_SESSION_EVENT_TYPES)}
  }

  enum AgentSessionPermissionDecision {
    ${graphQLEnumValues(AGENT_SESSION_PERMISSION_DECISIONS)}
  }

  input AgentSessionEventInput {
    attachmentIds: [ULID!]
    clientRequestId: String
    decision: AgentSessionPermissionDecision
    requestId: String
    runId: ULID
    text: String
    type: AgentSessionEventType!
  }

  type AgentSessionEventResult {
    clientRequestId: String
    run: SessionRun
    type: AgentSessionEventType!
  }

  type AgentSessionEventBatch {
    acceptedAt: String!
    events: [AgentSessionEventResult!]!
    session: Session!
    warnings: [UserWarning!]!
  }

  type SessionRuntimePrewarmAck {
    scheduledAt: String!
    sessionId: ULID!
  }

  enum AgentSessionRecoverabilityStatus {
    ${graphQLEnumValues(AGENT_SESSION_RECOVERABILITY_STATUSES)}
  }

  type AgentSessionRecoverability {
    reason: String
    status: AgentSessionRecoverabilityStatus!
  }

  type SessionExecutionBinding {
    agentId: ULID!
    deploymentVersionId: ULID
    deploymentVersionNumber: Int
    kind: AgentKind!
    model: String!
    prompt: String!
    provider: String!
    runtimeId: String!
    sessionId: ULID!
  }

  type SessionExecutionSkillReference {
    resolutionMode: String!
    sessionId: ULID!
    skillId: ULID!
    skillName: String!
    snapshotId: ULID
    sortOrder: Int!
  }

  type SessionExecutionToolReference {
    agentCredentialId: ULID
    credentialMode: String!
    serverId: ULID!
    sessionId: ULID!
    sortOrder: Int!
  }

  type SessionExecutionSpaceReference {
    sessionId: ULID!
    sortOrder: Int!
    spaceId: ULID!
  }

  type AgentSessionExecutionDiagnostics {
    binding: SessionExecutionBinding!
    skills: [SessionExecutionSkillReference!]!
    spaces: [SessionExecutionSpaceReference!]!
    tools: [SessionExecutionToolReference!]!
  }

  type AgentSessionNativeRuntimeRefDiagnostics {
    kind: String
    runtimeId: String
    status: String!
    valuePreview: String
  }

  type AgentSessionDiagnostics {
    execution: AgentSessionExecutionDiagnostics
    generatedAt: String!
    nativeRuntimeRef: AgentSessionNativeRuntimeRefDiagnostics!
    pendingPermissionCount: Int!
    session: Session!
  }

  enum AgentSessionActionCapabilityName {
    ${graphQLEnumValues(AGENT_SESSION_ACTION_CAPABILITY_NAMES)}
  }

  enum AgentSessionActionCapabilityStatus {
    ${graphQLEnumValues(AGENT_SESSION_ACTION_CAPABILITY_STATUSES)}
  }

  type AgentSessionActionCapability {
    action: AgentSessionActionCapabilityName!
    reason: String
    status: AgentSessionActionCapabilityStatus!
  }

  type AgentSessionRetrieve {
    capabilities: [AgentSessionActionCapability!]!
    recoverability: AgentSessionRecoverability!
    session: Session!
  }

  type AgentSessionRetrieveConnection {
    nodes: [AgentSessionRetrieve!]!
    pageInfo: SessionListPageInfo!
  }

  enum SessionStatus {
    ${graphQLEnumValues(SESSION_STATUSES)}
  }

  input RenameSessionInput {
    sessionId: ULID!
    title: String!
  }

  input CreateAgentSessionInput {
    agentId: ULID!
    type: SessionType
    waitForRuntimeReady: Boolean
  }

  enum FileScopeKind {
    ${graphQLEnumValues(FILE_SCOPE_KINDS)}
  }

  enum FileOwnerKind {
    ${graphQLEnumValues(FILE_OWNER_KINDS)}
  }

  enum FilePurpose {
    ${graphQLEnumValues(FILE_PURPOSES)}
  }

  enum FileUploadStatus {
    ${graphQLEnumValues(FILE_UPLOAD_STATUSES)}
  }

  enum FileUploadStrategy {
    ${graphQLEnumValues(FILE_UPLOAD_STRATEGIES)}
  }

  type FileScope {
    id: ULID!
    kind: FileScopeKind!
  }

  type FileOwner {
    id: ULID!
    kind: FileOwnerKind!
  }

  type SessionResource {
    createdAt: String!
    id: ULID!
    mimeType: String
    name: String!
    path: String!
    size: Int!
  }

  input AddSessionResourceFileInput {
    contentType: String!
    name: String!
    size: Int!
  }

  input AddSessionResourceInput {
    file: AddSessionResourceFileInput!
    sessionId: ULID!
  }

  input RemoveSessionResourceInput {
    resourceId: ULID!
    sessionId: ULID!
  }

  type SessionResourceUpload {
    contentType: String!
    expectedSize: Int!
    expiresAt: String!
    fileId: ULID!
    owner: FileOwner!
    partSize: Int
    path: String!
    purpose: FilePurpose!
    scope: FileScope!
    status: FileUploadStatus!
    strategy: FileUploadStrategy!
  }
`;
