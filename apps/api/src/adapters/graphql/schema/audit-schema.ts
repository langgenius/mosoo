export const auditSchema = /* GraphQL */ `
  enum AuditActorType {
    agent
    api_key
    system
    user
  }

  enum AuditOutcome {
    denied
    failure
    success
  }

  type AuditActor {
    display: String!
    id: String
    type: AuditActorType!
  }

  type AuditEvent {
    action: String!
    actor: AuditActor!
    after: PrimitiveRecord!
    before: PrimitiveRecord!
    correlationId: String
    id: ULID!
    ipAddress: String
    metadata: PrimitiveRecord!
    outcome: AuditOutcome!
    resourceDisplay: String
    resourceId: String
    resourceType: String!
    sessionId: ULID
    timestamp: String!
    userAgent: String
  }

  input AuditEventsFilterInput {
    organizationId: ULID!
    outcome: AuditOutcome
    q: String
    startMs: Float
  }
`;
