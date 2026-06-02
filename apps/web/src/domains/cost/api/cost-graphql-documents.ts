import { graphql } from "@/gql";

const TOTALS_FRAGMENT = graphql(/* GraphQL */ `
  fragment CostTotalsFields on CostAggregate {
    activeUsers
    cacheCreationTokens
    cacheReadTokens
    inputTokens
    outputTokens
    requestCount
    totalCostUsd
    unpricedRequestCount
  }
`);

const DAILY_FRAGMENT = graphql(/* GraphQL */ `
  fragment CostDailyFields on CostDailyPoint {
    activeUsers
    cacheCreationTokens
    cacheReadTokens
    date
    inputTokens
    outputTokens
    requestCount
    totalCostUsd
    unpricedRequestCount
  }
`);

const AGENT_FRAGMENT = graphql(/* GraphQL */ `
  fragment CostAgentFields on CostAgentRow {
    activeUsers
    agentId
    agentName
    cacheCreationTokens
    cacheReadTokens
    debugCostUsd
    evalCostUsd
    inputTokens
    outputTokens
    ownerEmail
    ownerId
    ownerName
    previousCostUsd
    previewCostUsd
    productionCostUsd
    requestCount
    scheduledCostUsd
    totalCostUsd
    unpricedRequestCount
  }
`);

const MODEL_FRAGMENT = graphql(/* GraphQL */ `
  fragment CostModelFields on CostModelRow {
    activeUsers
    cacheCreationTokens
    cacheReadTokens
    cacheReadUsdPerMillion
    cacheWriteUsdPerMillion
    inputTokens
    inputUsdPerMillion
    model
    outputTokens
    outputUsdPerMillion
    provider
    requestCount
    totalCostUsd
    unpricedRequestCount
    vendor
  }
`);

const RECENT_SESSION_FRAGMENT = graphql(/* GraphQL */ `
  fragment CostRecentSessionFields on CostRecentSession {
    actorEmail
    actorName
    actorUserId
    cacheCreationTokens
    cacheReadTokens
    createdAt
    inputTokens
    model
    outputTokens
    provider
    runPurpose
    sessionId
    sessionRunId
    totalCostUsd
  }
`);

const ATTRIBUTION_FRAGMENT = graphql(/* GraphQL */ `
  fragment CostAttributionFields on CostAttributionCard {
    agents {
      ...CostAgentFields
    }
    daily {
      ...CostDailyFields
    }
    models {
      ...CostModelFields
    }
    recentSessions {
      ...CostRecentSessionFields
    }
    totals {
      ...CostTotalsFields
    }
  }
`);

void TOTALS_FRAGMENT;
void DAILY_FRAGMENT;
void AGENT_FRAGMENT;
void MODEL_FRAGMENT;
void RECENT_SESSION_FRAGMENT;
void ATTRIBUTION_FRAGMENT;

export const ORGANIZATION_COST_QUERY = graphql(/* GraphQL */ `
  query OrganizationCostCard(
    $organizationId: ULID!
    $range: CostRange!
    $runPurposes: [CostRunPurpose!]
  ) {
    organizationCostCard(
      organizationId: $organizationId
      range: $range
      runPurposes: $runPurposes
    ) {
      agents {
        ...CostAgentFields
      }
      daily {
        ...CostDailyFields
      }
      models {
        ...CostModelFields
      }
      ownerUsers {
        activeUsers
        agentCount
        cacheCreationTokens
        cacheReadTokens
        inputTokens
        outputTokens
        previousCostUsd
        requestCount
        topAgentId
        topAgentName
        totalCostUsd
        unpricedRequestCount
        userEmail
        userId
        userName
      }
      previousTotals {
        ...CostTotalsFields
      }
      recentSessions {
        ...CostRecentSessionFields
      }
      totals {
        ...CostTotalsFields
      }
      users {
        activeUsers
        agentCount
        cacheCreationTokens
        cacheReadTokens
        inputTokens
        outputTokens
        previousCostUsd
        requestCount
        topAgentId
        topAgentName
        totalCostUsd
        unpricedRequestCount
        userEmail
        userId
        userName
      }
    }
  }
`);

export const AGENT_COST_QUERY = graphql(/* GraphQL */ `
  query AgentCostCard($agentId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {
    agentCostCard(agentId: $agentId, range: $range, runPurposes: $runPurposes) {
      agentId
      agentName
      agents {
        ...CostAgentFields
      }
      daily {
        ...CostDailyFields
      }
      models {
        ...CostModelFields
      }
      ownerId
      ownerName
      recentSessions {
        ...CostRecentSessionFields
      }
      totals {
        ...CostTotalsFields
      }
      users {
        activeUsers
        agentCount
        cacheCreationTokens
        cacheReadTokens
        inputTokens
        outputTokens
        previousCostUsd
        requestCount
        topAgentId
        topAgentName
        totalCostUsd
        unpricedRequestCount
        userEmail
        userId
        userName
      }
    }
  }
`);

export const MEMBER_COST_QUERY = graphql(/* GraphQL */ `
  query MemberCostCard($organizationId: ULID!, $memberId: ULID!, $range: CostRange!) {
    memberCostCard(organizationId: $organizationId, memberId: $memberId, range: $range) {
      owned {
        ...CostAttributionFields
      }
      used {
        ...CostAttributionFields
      }
    }
  }
`);
