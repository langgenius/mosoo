export const costSchema = /* GraphQL */ `
  enum CostRange {
    LAST_7_DAYS
    LAST_30_DAYS
    MONTH_TO_DATE
    LAST_90_DAYS
  }

  enum CostRunPurpose {
    debug
    eval
    preview
    production
    scheduled
  }

  interface CostAggregate {
    activeUsers: Int!
    cacheCreationTokens: Int!
    cacheReadTokens: Int!
    inputTokens: Int!
    outputTokens: Int!
    requestCount: Int!
    totalCostUsd: Float!
    unpricedRequestCount: Int!
  }

  type CostTotals implements CostAggregate {
    activeUsers: Int!
    cacheCreationTokens: Int!
    cacheReadTokens: Int!
    inputTokens: Int!
    outputTokens: Int!
    requestCount: Int!
    totalCostUsd: Float!
    unpricedRequestCount: Int!
  }

  type CostDailyPoint implements CostAggregate {
    activeUsers: Int!
    cacheCreationTokens: Int!
    cacheReadTokens: Int!
    date: String!
    inputTokens: Int!
    outputTokens: Int!
    requestCount: Int!
    totalCostUsd: Float!
    unpricedRequestCount: Int!
  }

  type CostAgentRow implements CostAggregate {
    activeUsers: Int!
    agentId: ULID!
    agentName: String!
    cacheCreationTokens: Int!
    cacheReadTokens: Int!
    debugCostUsd: Float!
    evalCostUsd: Float!
    inputTokens: Int!
    outputTokens: Int!
    ownerEmail: String
    ownerId: ULID!
    ownerName: String!
    previousCostUsd: Float
    previewCostUsd: Float!
    productionCostUsd: Float!
    requestCount: Int!
    scheduledCostUsd: Float!
    totalCostUsd: Float!
    unpricedRequestCount: Int!
  }

  type CostUserRow implements CostAggregate {
    activeUsers: Int!
    agentCount: Int!
    cacheCreationTokens: Int!
    cacheReadTokens: Int!
    inputTokens: Int!
    outputTokens: Int!
    previousCostUsd: Float
    requestCount: Int!
    topAgentId: ULID
    topAgentName: String
    totalCostUsd: Float!
    unpricedRequestCount: Int!
    userEmail: String
    userId: ULID!
    userName: String!
  }

  type CostModelRow implements CostAggregate {
    activeUsers: Int!
    cacheCreationTokens: Int!
    cacheReadTokens: Int!
    cacheReadUsdPerMillion: Float
    cacheWriteUsdPerMillion: Float
    inputTokens: Int!
    inputUsdPerMillion: Float
    model: String!
    outputTokens: Int!
    outputUsdPerMillion: Float
    provider: String!
    requestCount: Int!
    totalCostUsd: Float!
    unpricedRequestCount: Int!
    vendor: String!
  }

  type CostRecentSession {
    actorEmail: String
    actorName: String!
    actorUserId: ULID!
    cacheCreationTokens: Int!
    cacheReadTokens: Int!
    createdAt: String!
    inputTokens: Int!
    model: String!
    outputTokens: Int!
    provider: String!
    runPurpose: String!
    sessionId: ULID
    sessionRunId: ULID
    totalCostUsd: Float!
  }

  type CostAttributionCard {
    agents: [CostAgentRow!]!
    daily: [CostDailyPoint!]!
    models: [CostModelRow!]!
    recentSessions: [CostRecentSession!]!
    totals: CostTotals!
  }

  type OrganizationCostCard {
    agents: [CostAgentRow!]!
    daily: [CostDailyPoint!]!
    models: [CostModelRow!]!
    ownerUsers: [CostUserRow!]!
    previousTotals: CostTotals!
    recentSessions: [CostRecentSession!]!
    totals: CostTotals!
    users: [CostUserRow!]!
  }

  type AgentCostCard {
    agentId: ULID!
    agentName: String!
    agents: [CostAgentRow!]!
    daily: [CostDailyPoint!]!
    models: [CostModelRow!]!
    ownerId: ULID!
    ownerName: String!
    recentSessions: [CostRecentSession!]!
    totals: CostTotals!
    users: [CostUserRow!]!
  }

  type MemberCostCard {
    owned: CostAttributionCard!
    used: CostAttributionCard!
  }
`;
