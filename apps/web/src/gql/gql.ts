/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  fragment AgentChannelBindingFields on AgentChannelBinding {\n    activityLastTriggeredAt\n    activitySessionCount7d\n    agentId\n    createdAt\n    displayMetadata\n    externalBotId\n    externalTenantId\n    id\n    lastErrorCode\n    provider\n    status\n    updatedAt\n  }\n": typeof types.AgentChannelBindingFieldsFragmentDoc,
    "\n  query AgentChannelBindings($appId: ULID!, $agentId: ULID!) {\n    agentChannelBindingList(appId: $appId, agentId: $agentId) {\n      ...AgentChannelBindingFields\n    }\n  }\n": typeof types.AgentChannelBindingsDocument,
    "\n  mutation CreateSlackAgentChannelBinding($input: CreateSlackAgentChannelBindingInput!) {\n    createSlackAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n": typeof types.CreateSlackAgentChannelBindingDocument,
    "\n  mutation CreateLarkAgentChannelBinding($input: CreateLarkAgentChannelBindingInput!) {\n    createLarkAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n": typeof types.CreateLarkAgentChannelBindingDocument,
    "\n  fragment LarkAgentChannelRegistrationFields on LarkAgentChannelRegistration {\n    appId\n    appSecret\n    deviceCode\n    domain\n    expireIn\n    interval\n    lastErrorCode\n    openId\n    qrUrl\n    status\n    userCode\n  }\n": typeof types.LarkAgentChannelRegistrationFieldsFragmentDoc,
    "\n  mutation StartLarkAgentChannelRegistration($input: StartLarkAgentChannelRegistrationInput!) {\n    startLarkAgentChannelRegistration(input: $input) {\n      ...LarkAgentChannelRegistrationFields\n    }\n  }\n": typeof types.StartLarkAgentChannelRegistrationDocument,
    "\n  mutation PollLarkAgentChannelRegistration($input: PollLarkAgentChannelRegistrationInput!) {\n    pollLarkAgentChannelRegistration(input: $input) {\n      ...LarkAgentChannelRegistrationFields\n    }\n  }\n": typeof types.PollLarkAgentChannelRegistrationDocument,
    "\n  mutation CreateTelegramAgentChannelBinding($input: CreateTelegramAgentChannelBindingInput!) {\n    createTelegramAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n": typeof types.CreateTelegramAgentChannelBindingDocument,
    "\n  mutation CreateDiscordAgentChannelBinding($input: CreateDiscordAgentChannelBindingInput!) {\n    createDiscordAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n": typeof types.CreateDiscordAgentChannelBindingDocument,
    "\n  fragment WeChatAgentChannelPairingFields on WeChatAgentChannelPairing {\n    binding {\n      ...AgentChannelBindingFields\n    }\n    lastErrorCode\n    qrCodeImageSrc\n    qrToken\n    status\n  }\n": typeof types.WeChatAgentChannelPairingFieldsFragmentDoc,
    "\n  mutation StartWeChatAgentChannelPairing($input: StartWeChatAgentChannelPairingInput!) {\n    startWeChatAgentChannelPairing(input: $input) {\n      ...WeChatAgentChannelPairingFields\n    }\n  }\n": typeof types.StartWeChatAgentChannelPairingDocument,
    "\n  mutation PollWeChatAgentChannelPairing($input: PollWeChatAgentChannelPairingInput!) {\n    pollWeChatAgentChannelPairing(input: $input) {\n      ...WeChatAgentChannelPairingFields\n    }\n  }\n": typeof types.PollWeChatAgentChannelPairingDocument,
    "\n  mutation DeleteAgentChannelBinding($input: DeleteAgentChannelBindingInput!) {\n    deleteAgentChannelBinding(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteAgentChannelBindingDocument,
    "\n  fragment AgentFields on Agent {\n    createdAt\n    description\n    id\n    kind\n    liveVersion {\n      ...AgentDeploymentVersionFields\n    }\n    model\n    name\n    appId\n    prompt\n    provider\n    runtimeId\n    skills {\n      ownerName\n      skillId\n      skillName\n      state\n    }\n    status\n    updatedAt\n    visibility\n  }\n": typeof types.AgentFieldsFragmentDoc,
    "\n  fragment AgentToolSummaryFields on AgentToolSummary {\n    enabled\n    iconUrl\n    name\n    serverId\n  }\n": typeof types.AgentToolSummaryFieldsFragmentDoc,
    "\n  fragment AgentDeploymentVersionFields on AgentDeploymentVersion {\n    agentId\n    createdAt\n    createdByAccountId\n    environmentId\n    id\n    isLive\n    kind\n    model\n    provider\n    runtimeId\n    summary\n    versionNumber\n  }\n": typeof types.AgentDeploymentVersionFieldsFragmentDoc,
    "\n  fragment AgentOwnerFields on AgentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n": typeof types.AgentOwnerFieldsFragmentDoc,
    "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n": typeof types.CreateAgentDocument,
    "\n  mutation DeleteAgent($input: DeleteAgentInput!) {\n    deleteAgent(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteAgentDocument,
    "\n  query AccessibleAgents($appId: ULID!) {\n    accessibleAgentList(appId: $appId) {\n      createdAt\n      description\n      id\n      kind\n      name\n      appId\n      owner {\n        ...AgentOwnerFields\n      }\n      runtimeId\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      viewerRole\n      visibility\n    }\n  }\n": typeof types.AccessibleAgentsDocument,
    "\n  query Agent($agentId: ULID!, $appId: ULID!) {\n    agent(agentId: $agentId, appId: $appId) {\n      createdAt\n      description\n      id\n      kind\n      liveVersion {\n        ...AgentDeploymentVersionFields\n      }\n      model\n      name\n      appId\n      owner {\n        ...AgentOwnerFields\n      }\n      prompt\n      provider\n      runtimeId\n      skills {\n        ownerName\n        skillId\n        skillName\n        state\n      }\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      versions {\n        ...AgentDeploymentVersionFields\n      }\n      viewerRole\n      visibility\n    }\n  }\n": typeof types.AgentDocument,
    "\n  query AgentEditorState($agentId: ULID!, $appId: ULID!) {\n    agentEditorState(agentId: $agentId, appId: $appId) {\n      id\n      builtInTools {\n        enabled\n        name\n      }\n      environment {\n        environmentId\n      }\n      packageResolution {\n        recordedAt\n        source\n        report {\n          issues {\n            actionLabel\n            code\n            message\n            required\n            severity\n            status\n            targetLabel\n            targetType\n          }\n          summary {\n            boundMcpServerCount\n            boundSkillCount\n            copiedAssetCount\n            createdMcpServerCount\n            reusedMcpServerCount\n          }\n        }\n      }\n      providerOptions\n      mcpBindings {\n        authType\n        authorizationState\n        createdAt\n        credentialMode\n        credentialScope\n        credentialStatus\n        credentialSubject\n        enabled\n        hasCredential\n        iconUrl\n        id\n        name\n        serverId\n        source\n        updatedAt\n        url\n      }\n      readiness {\n        checkedAt\n        ready\n        issues {\n          code\n          message\n          severity\n        }\n      }\n    }\n  }\n": typeof types.AgentEditorStateDocument,
    "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      ...AgentFields\n    }\n  }\n": typeof types.UpdateAgentConfigDocument,
    "\n  query AgentManifest($agentId: ULID!, $appId: ULID!) {\n    agentManifest(agentId: $agentId, appId: $appId) {\n      agentId\n      json\n      yaml\n    }\n  }\n": typeof types.AgentManifestDocument,
    "\n  query ExportAgentPackage($agentId: ULID!, $appId: ULID!) {\n    exportAgentPackage(agentId: $agentId, appId: $appId) {\n      agentId\n      contentType\n      fileId\n      fileName\n      manifestYaml\n      size\n    }\n  }\n": typeof types.ExportAgentPackageDocument,
    "\n  mutation ImportAgentPackage($input: ImportAgentPackageInput!) {\n    importAgentPackage(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n": typeof types.ImportAgentPackageDocument,
    "\n  mutation CreateAgentFork($input: CreateAgentForkInput!) {\n    createAgentFork(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n": typeof types.CreateAgentForkDocument,
    "\n  mutation PublishAgent($input: PublishAgentInput!) {\n    publishAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n": typeof types.PublishAgentDocument,
    "\n  mutation UnpublishAgent($agentId: ULID!, $appId: ULID!) {\n    unpublishAgent(agentId: $agentId, appId: $appId) {\n      ...AgentFields\n    }\n  }\n": typeof types.UnpublishAgentDocument,
    "\n  mutation RestartDriver($input: RuntimeStateOperationInput!) {\n    restartDriver(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": typeof types.RestartDriverDocument,
    "\n  mutation RecreateSandbox($input: RuntimeStateOperationInput!) {\n    recreateSandbox(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": typeof types.RecreateSandboxDocument,
    "\n  mutation ResetAgentState($input: RuntimeStateOperationInput!) {\n    resetAgentState(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": typeof types.ResetAgentStateDocument,
    "\n  query AppList($organizationId: ULID!) {\n    appList(organizationId: $organizationId) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n": typeof types.AppListDocument,
    "\n  mutation CreateApp($input: CreateAppInput!) {\n    createApp(input: $input) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n": typeof types.CreateAppDocument,
    "\n  mutation RenameApp($input: RenameAppInput!) {\n    renameApp(input: $input) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n": typeof types.RenameAppDocument,
    "\n  query AppDeploymentOverview($appId: ULID!) {\n    appOverview(appId: $appId) {\n      app {\n        id\n        name\n      }\n      boundAgents {\n        agentId\n        envVar\n        expose\n        name\n      }\n      deployment {\n        appId\n        createdAt\n        defaultBranch\n        id\n        liveUrl\n        plannedUrl\n        repoName\n        repoOwner\n        repoUrl\n        updatedAt\n        latestRun {\n          appId\n          createdAt\n          deploymentId\n          errorCode\n          errorMessage\n          id\n          liveUrl\n          plannedUrl\n          sourceBranch\n          sourceCommitSha\n          status\n          targetKind\n          updatedAt\n        }\n      }\n    }\n  }\n": typeof types.AppDeploymentOverviewDocument,
    "\n  query AppDeploymentRunList($appId: ULID!, $limit: Int) {\n    appDeploymentRunList(appId: $appId, limit: $limit) {\n      appId\n      createdAt\n      deploymentId\n      errorCode\n      errorMessage\n      id\n      liveUrl\n      plannedUrl\n      sourceBranch\n      sourceCommitSha\n      status\n      targetKind\n      updatedAt\n    }\n  }\n": typeof types.AppDeploymentRunListDocument,
    "\n  mutation DeployApp($input: DeployAppInput!) {\n    deployApp(input: $input) {\n      appId\n      createdAt\n      deploymentId\n      errorCode\n      errorMessage\n      id\n      liveUrl\n      plannedUrl\n      sourceBranch\n      sourceCommitSha\n      status\n      targetKind\n      updatedAt\n    }\n  }\n": typeof types.DeployAppDocument,
    "\n  mutation DeleteAppDeployment($input: DeleteAppDeploymentInput!) {\n    deleteAppDeployment(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteAppDeploymentDocument,
    "\n  fragment CostTotalsFields on CostAggregate {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n": typeof types.CostTotalsFieldsFragmentDoc,
    "\n  fragment CostDailyFields on CostDailyPoint {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    date\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n": typeof types.CostDailyFieldsFragmentDoc,
    "\n  fragment CostAgentFields on CostAgentRow {\n    activeUsers\n    agentId\n    agentName\n    cacheCreationTokens\n    cacheReadTokens\n    debugCostUsd\n    evalCostUsd\n    inputTokens\n    outputTokens\n    ownerEmail\n    ownerId\n    ownerName\n    previousCostUsd\n    previewCostUsd\n    productionCostUsd\n    requestCount\n    scheduledCostUsd\n    totalCostUsd\n    unpricedRequestCount\n  }\n": typeof types.CostAgentFieldsFragmentDoc,
    "\n  fragment CostModelFields on CostModelRow {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    cacheReadUsdPerMillion\n    cacheWriteUsdPerMillion\n    inputTokens\n    inputUsdPerMillion\n    model\n    outputTokens\n    outputUsdPerMillion\n    provider\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n    vendor\n  }\n": typeof types.CostModelFieldsFragmentDoc,
    "\n  fragment CostRecentSessionFields on CostRecentSession {\n    actorEmail\n    actorName\n    cacheCreationTokens\n    cacheReadTokens\n    createdAt\n    inputTokens\n    model\n    outputTokens\n    provider\n    runPurpose\n    sessionId\n    sessionRunId\n    totalCostUsd\n  }\n": typeof types.CostRecentSessionFieldsFragmentDoc,
    "\n  fragment CostAttributionFields on CostAttributionCard {\n    agents {\n      ...CostAgentFields\n    }\n    daily {\n      ...CostDailyFields\n    }\n    models {\n      ...CostModelFields\n    }\n    recentSessions {\n      ...CostRecentSessionFields\n    }\n    totals {\n      ...CostTotalsFields\n    }\n  }\n": typeof types.CostAttributionFieldsFragmentDoc,
    "\n  query AppCostCard($appId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {\n    appCostCard(appId: $appId, range: $range, runPurposes: $runPurposes) {\n      appId\n      appName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      previousTotals {\n        ...CostTotalsFields\n      }\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n    }\n  }\n": typeof types.AppCostCardDocument,
    "\n  query AgentCostCard(\n    $appId: ULID!\n    $agentId: ULID!\n    $range: CostRange!\n    $runPurposes: [CostRunPurpose!]\n  ) {\n    agentCostCard(appId: $appId, agentId: $agentId, range: $range, runPurposes: $runPurposes) {\n      agentId\n      agentName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerId\n      ownerName\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n    }\n  }\n": typeof types.AgentCostCardDocument,
    "\n  fragment EnvironmentPackageFields on EnvironmentPackageSpec {\n    manager\n    packages\n  }\n": typeof types.EnvironmentPackageFieldsFragmentDoc,
    "\n  fragment EnvironmentVariableFields on EnvironmentVariablePreview {\n    key\n    preview\n    status\n  }\n": typeof types.EnvironmentVariableFieldsFragmentDoc,
    "\n  fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n": typeof types.EnvironmentOwnerFieldsFragmentDoc,
    "\n  fragment EnvironmentSummaryFields on EnvironmentSummary {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    appId\n  }\n": typeof types.EnvironmentSummaryFieldsFragmentDoc,
    "\n  fragment EnvironmentDetailFields on EnvironmentDetail {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    appId\n  }\n": typeof types.EnvironmentDetailFieldsFragmentDoc,
    "\n  query AppEnvironments($appId: ULID!) {\n    appEnvironmentList(appId: $appId) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": typeof types.AppEnvironmentsDocument,
    "\n  query EnvironmentDetail($appId: ULID!, $environmentId: ULID!) {\n    environment(appId: $appId, environmentId: $environmentId) {\n      ...EnvironmentDetailFields\n    }\n  }\n": typeof types.EnvironmentDetailDocument,
    "\n  mutation CreateEnvironment($input: CreateEnvironmentInput!) {\n    createEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": typeof types.CreateEnvironmentDocument,
    "\n  mutation UpdateEnvironment($input: UpdateEnvironmentInput!) {\n    updateEnvironment(input: $input) {\n      ...EnvironmentDetailFields\n    }\n  }\n": typeof types.UpdateEnvironmentDocument,
    "\n  mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {\n    deleteEnvironment(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteEnvironmentDocument,
    "\n  mutation SetAppDefaultEnvironment($input: SetAppDefaultEnvironmentInput!) {\n    setAppDefaultEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": typeof types.SetAppDefaultEnvironmentDocument,
    "\n  query FileList($input: FileListInput!) {\n    fileList(input: $input) {\n      files {\n        createdAt\n        createdBy\n        etag\n        expiresAt\n        id\n        mimeType\n        name\n        path\n        sessionKind\n        size\n        status\n        updatedAt\n        version\n      }\n    }\n  }\n": typeof types.FileListDocument,
    "\n  fragment McpCredentialFields on McpCredentialSummary {\n    authType\n    createdAt\n    expiresAt\n    id\n    scope\n    scopeValues\n    status\n    subjectLabel\n    updatedAt\n  }\n": typeof types.McpCredentialFieldsFragmentDoc,
    "\n  fragment McpServerFields on McpServerWithCredential {\n    authType\n    authorizationState\n    createdAt\n    credentialScope\n    credentialStatus\n    description\n    enabled\n    hasCredential\n    iconUrl\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    source\n    updatedAt\n    url\n    credential {\n      ...McpCredentialFields\n    }\n  }\n": typeof types.McpServerFieldsFragmentDoc,
    "\n  query McpRegistry($appId: ULID!) {\n    mcpRegistry(appId: $appId) {\n      currentUserEmail\n      currentUserId\n      currentUserName\n      appId\n      servers {\n        ...McpServerFields\n      }\n    }\n  }\n": typeof types.McpRegistryDocument,
    "\n  mutation CreateAppMcpServer($input: CreateAppMcpServerInput!) {\n    createAppMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": typeof types.CreateAppMcpServerDocument,
    "\n  mutation ConnectMcpBearer($input: ConnectMcpBearerInput!) {\n    connectMcpBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": typeof types.ConnectMcpBearerDocument,
    "\n  mutation RevokeMcpCredential($appId: ULID!, $serverId: ULID!) {\n    revokeMcpCredential(appId: $appId, serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n": typeof types.RevokeMcpCredentialDocument,
    "\n  mutation SetMcpServerEnabled($appId: ULID!, $serverId: ULID!, $enabled: Boolean!) {\n    setMcpServerEnabled(appId: $appId, serverId: $serverId, enabled: $enabled) {\n      ...McpServerFields\n    }\n  }\n": typeof types.SetMcpServerEnabledDocument,
    "\n  mutation UpdateAppMcpServer($input: UpdateAppMcpServerInput!) {\n    updateAppMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": typeof types.UpdateAppMcpServerDocument,
    "\n  mutation DeleteMcpServer($appId: ULID!, $serverId: ULID!) {\n    deleteMcpServer(appId: $appId, serverId: $serverId) {\n      ok\n    }\n  }\n": typeof types.DeleteMcpServerDocument,
    "\n  mutation StartMcpOAuth($input: StartMcpOAuthInput!) {\n    startMcpOAuth(input: $input) {\n      authorizationUrl\n      flowId\n    }\n  }\n": typeof types.StartMcpOAuthDocument,
    "\n  query McpOAuthFlowStatus($flowId: ULID!) {\n    mcpOAuthFlowStatus(flowId: $flowId) {\n      authorizationState\n      errorMessage\n      flowId\n      serverId\n      status\n      subjectLabel\n    }\n  }\n": typeof types.McpOAuthFlowStatusDocument,
    "\n  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {\n    onboardingBootstrap(input: $input) {\n      completed\n      organization {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n    }\n  }\n": typeof types.OnboardingBootstrapDocument,
    "\n  mutation RenameOrganization($input: RenameOrganizationInput!) {\n    renameOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      name\n    }\n  }\n": typeof types.RenameOrganizationDocument,
    "\n  query ThreadAgentSessionRetrieve($appId: ULID!, $sessionId: ULID!) {\n    threadAgentSessionRetrieve(appId: $appId, sessionId: $sessionId) {\n      capabilities {\n        action\n        reason\n        status\n      }\n      recoverability {\n        reason\n        status\n      }\n      session {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        appId\n        runtimeId\n        status\n        title\n        updatedAt\n      }\n    }\n  }\n": typeof types.ThreadAgentSessionRetrieveDocument,
    "\n  query AgentSessionDiagnostics($appId: ULID!, $sessionId: ULID!) {\n    agentSessionDiagnostics(appId: $appId, sessionId: $sessionId) {\n      execution {\n        binding {\n          deploymentVersionId\n          deploymentVersionNumber\n          kind\n          model\n          provider\n          runtimeId\n          sessionId\n        }\n        skills {\n          skillId\n          skillName\n        }\n        tools {\n          credentialMode\n          serverId\n        }\n      }\n      generatedAt\n      nativeRuntimeRef {\n        kind\n        runtimeId\n        status\n        valuePreview\n      }\n      pendingPermissionCount\n      session {\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastRun {\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          model\n          provider\n          status\n          traceId\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n      }\n    }\n  }\n": typeof types.AgentSessionDiagnosticsDocument,
    "\n  mutation CreateAgentSession($input: CreateAgentSessionInput!) {\n    createAgentSession(input: $input) {\n      agentId\n      archivedAt\n      createdAt\n      deploymentVersionId\n      deploymentVersionNumber\n      id\n      kind\n      lastMessageAt\n      lastRun {\n        completedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        error {\n          code\n          details\n          message\n          retryable\n        }\n        id\n        model\n        provider\n        startedAt\n        status\n        traceId\n        trigger\n        updatedAt\n      }\n      model\n      provider\n      appId\n      runtimeId\n      status\n      title\n      type\n      updatedAt\n    }\n  }\n": typeof types.CreateAgentSessionDocument,
    "\n  query AgentSessionList(\n    $agentId: ULID!\n    $archived: Boolean\n    $participantOnly: Boolean\n    $appId: ULID!\n    $type: SessionType\n  ) {\n    agentSessionList(\n      agentId: $agentId\n      archived: $archived\n      participantOnly: $participantOnly\n      appId: $appId\n      type: $type\n    ) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        appId\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n      }\n    }\n  }\n": typeof types.AgentSessionListDocument,
    "\n  query AgentSessionProcessEvents($limit: Int!, $appId: ULID!, $sessionId: ULID!) {\n    sessionProcessEvents(limit: $limit, appId: $appId, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n": typeof types.AgentSessionProcessEventsDocument,
    "\n  query ThreadSessionMessages($appId: ULID!, $sessionId: ULID!) {\n    threadSessionMessages(appId: $appId, sessionId: $sessionId) {\n      content\n      createdAt\n      createdBy\n      id\n      plan {\n        content\n        priority\n        status\n      }\n      role\n      segments {\n        argsText\n        kind\n        output\n        path\n        text\n        tool\n        toolCallId\n      }\n    }\n  }\n": typeof types.ThreadSessionMessagesDocument,
    "\n  mutation SendAgentSessionEvents(\n    $appId: ULID!\n    $sessionId: ULID!\n    $events: [AgentSessionEventInput!]!\n  ) {\n    sendAgentSessionEvents(appId: $appId, sessionId: $sessionId, events: $events) {\n      acceptedAt\n      warnings {\n        code\n        message\n      }\n    }\n  }\n": typeof types.SendAgentSessionEventsDocument,
    "\n  mutation PrewarmAgentSession($appId: ULID!, $sessionId: ULID!) {\n    prewarmAgentSession(appId: $appId, sessionId: $sessionId) {\n      scheduledAt\n      sessionId\n    }\n  }\n": typeof types.PrewarmAgentSessionDocument,
    "\n  query ThreadAgentSessionList($appId: ULID!, $archived: Boolean, $type: SessionType) {\n    threadAgentSessionList(appId: $appId, archived: $archived, type: $type) {\n      nodes {\n        capabilities {\n          action\n          reason\n          status\n        }\n        session {\n          agentId\n          archivedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          kind\n          lastMessageAt\n          lastRun {\n            completedAt\n            createdAt\n            deploymentVersionId\n            deploymentVersionNumber\n            error {\n              code\n              details\n              message\n              retryable\n            }\n            id\n            model\n            provider\n            startedAt\n            status\n            traceId\n            trigger\n            updatedAt\n          }\n          model\n          provider\n          appId\n          runtimeId\n          status\n          title\n          type\n          updatedAt\n        }\n      }\n    }\n  }\n": typeof types.ThreadAgentSessionListDocument,
    "\n  mutation AutoTitleSession($input: RenameSessionInput!) {\n    autoTitleSession(input: $input) {\n      id\n    }\n  }\n": typeof types.AutoTitleSessionDocument,
    "\n  mutation ArchiveSession($appId: ULID!, $sessionId: ULID!) {\n    archiveAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n": typeof types.ArchiveSessionDocument,
    "\n  mutation RestoreSession($appId: ULID!, $sessionId: ULID!) {\n    unarchiveAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n": typeof types.RestoreSessionDocument,
    "\n  mutation DeleteAgentSession($appId: ULID!, $sessionId: ULID!) {\n    deleteAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n": typeof types.DeleteAgentSessionDocument,
    "\n  mutation AddSessionResource($input: AddSessionResourceInput!) {\n    addSessionResource(input: $input) {\n      contentType\n      expectedSize\n      expiresAt\n      fileId\n      partSize\n      path\n      status\n      strategy\n    }\n  }\n": typeof types.AddSessionResourceDocument,
    "\n  query SessionProcessEvents($limit: Int!, $appId: ULID!, $sessionId: ULID!) {\n    threadSessionProcessEvents(limit: $limit, appId: $appId, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n": typeof types.SessionProcessEventsDocument,
    "\n  fragment SkillSummaryFields on SkillSummary {\n    author\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    snapshotId\n    sourceKind\n    updatedAt\n  }\n": typeof types.SkillSummaryFieldsFragmentDoc,
    "\n  fragment SkillDetailFields on SkillDetail {\n    author\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    snapshotId\n    sourceKind\n    updatedAt\n    currentSnapshot {\n      archiveFormat\n      author\n      blobKey\n      blobSha256\n      blobSize\n      compression\n      createdAt\n      description\n      id\n      name\n      skillMarkdownPath\n      uncompressedSize\n      version\n    }\n    entries {\n      entryKind\n      isExecutable\n      mimeType\n      path\n      sha256\n      size\n    }\n  }\n": typeof types.SkillDetailFieldsFragmentDoc,
    "\n  query SkillDetail($appId: ULID!, $skillId: ULID!) {\n    skillDetail(appId: $appId, skillId: $skillId) {\n      ...SkillDetailFields\n    }\n  }\n": typeof types.SkillDetailDocument,
    "\n  query AppSkills($appId: ULID!) {\n    appSkillList(appId: $appId) {\n      ...SkillSummaryFields\n    }\n  }\n": typeof types.AppSkillsDocument,
    "\n  mutation CreateSkillFork($input: CreateSkillForkInput!) {\n    createSkillFork(input: $input) {\n      ...SkillSummaryFields\n    }\n  }\n": typeof types.CreateSkillForkDocument,
    "\n  mutation DeleteOwnedSkill($appId: ULID!, $skillId: ULID!) {\n    deleteOwnedSkill(appId: $appId, skillId: $skillId) {\n      ok\n    }\n  }\n": typeof types.DeleteOwnedSkillDocument,
    "\n  query Viewer {\n    viewer {\n      account {\n        email\n        id\n        imageUrl\n        name\n        systemAgentModel {\n          modelId\n          vendor\n        }\n      }\n      activeOrganization {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n      auth {\n        currentSecurityLevel\n        methods\n      }\n      organizations {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n    }\n  }\n": typeof types.ViewerDocument,
    "\n  mutation UpdateProfile($input: UpdateAccountProfileInput!) {\n    updateProfile(input: $input) {\n      imageUrl\n      name\n    }\n  }\n": typeof types.UpdateProfileDocument,
    "\n  query VendorCredentialList($appId: ULID!) {\n    vendorCredentialList(appId: $appId) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n": typeof types.VendorCredentialListDocument,
    "\n  mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {\n    createVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n": typeof types.CreateVendorCredentialDocument,
    "\n  mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {\n    updateVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n": typeof types.UpdateVendorCredentialDocument,
    "\n  mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {\n    deleteVendorCredential(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteVendorCredentialDocument,
    "\n  mutation SetDefaultVendorCredential($input: SetDefaultVendorCredentialInput!) {\n    setDefaultVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n": typeof types.SetDefaultVendorCredentialDocument,
    "\n  query AvailableAgentModels(\n    $appId: ULID!\n    $runtimeId: String!\n    $currentModelId: String\n    $currentVendorId: String\n  ) {\n    availableAgentModels(\n      appId: $appId\n      runtimeId: $runtimeId\n      currentModelId: $currentModelId\n      currentVendorId: $currentVendorId\n    ) {\n      available\n      displayName\n      modelId\n      reason\n      source\n      statusDetail\n      statusLabel\n      vendorId\n      vendorLabel\n    }\n  }\n": typeof types.AvailableAgentModelsDocument,
    "\n  mutation TestVendorCredential($input: TestVendorCredentialInput!) {\n    testVendorCredential(input: $input) {\n      errorCode\n      latencyMs\n      ok\n    }\n  }\n": typeof types.TestVendorCredentialDocument,
};
const documents: Documents = {
    "\n  fragment AgentChannelBindingFields on AgentChannelBinding {\n    activityLastTriggeredAt\n    activitySessionCount7d\n    agentId\n    createdAt\n    displayMetadata\n    externalBotId\n    externalTenantId\n    id\n    lastErrorCode\n    provider\n    status\n    updatedAt\n  }\n": types.AgentChannelBindingFieldsFragmentDoc,
    "\n  query AgentChannelBindings($appId: ULID!, $agentId: ULID!) {\n    agentChannelBindingList(appId: $appId, agentId: $agentId) {\n      ...AgentChannelBindingFields\n    }\n  }\n": types.AgentChannelBindingsDocument,
    "\n  mutation CreateSlackAgentChannelBinding($input: CreateSlackAgentChannelBindingInput!) {\n    createSlackAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n": types.CreateSlackAgentChannelBindingDocument,
    "\n  mutation CreateLarkAgentChannelBinding($input: CreateLarkAgentChannelBindingInput!) {\n    createLarkAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n": types.CreateLarkAgentChannelBindingDocument,
    "\n  fragment LarkAgentChannelRegistrationFields on LarkAgentChannelRegistration {\n    appId\n    appSecret\n    deviceCode\n    domain\n    expireIn\n    interval\n    lastErrorCode\n    openId\n    qrUrl\n    status\n    userCode\n  }\n": types.LarkAgentChannelRegistrationFieldsFragmentDoc,
    "\n  mutation StartLarkAgentChannelRegistration($input: StartLarkAgentChannelRegistrationInput!) {\n    startLarkAgentChannelRegistration(input: $input) {\n      ...LarkAgentChannelRegistrationFields\n    }\n  }\n": types.StartLarkAgentChannelRegistrationDocument,
    "\n  mutation PollLarkAgentChannelRegistration($input: PollLarkAgentChannelRegistrationInput!) {\n    pollLarkAgentChannelRegistration(input: $input) {\n      ...LarkAgentChannelRegistrationFields\n    }\n  }\n": types.PollLarkAgentChannelRegistrationDocument,
    "\n  mutation CreateTelegramAgentChannelBinding($input: CreateTelegramAgentChannelBindingInput!) {\n    createTelegramAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n": types.CreateTelegramAgentChannelBindingDocument,
    "\n  mutation CreateDiscordAgentChannelBinding($input: CreateDiscordAgentChannelBindingInput!) {\n    createDiscordAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n": types.CreateDiscordAgentChannelBindingDocument,
    "\n  fragment WeChatAgentChannelPairingFields on WeChatAgentChannelPairing {\n    binding {\n      ...AgentChannelBindingFields\n    }\n    lastErrorCode\n    qrCodeImageSrc\n    qrToken\n    status\n  }\n": types.WeChatAgentChannelPairingFieldsFragmentDoc,
    "\n  mutation StartWeChatAgentChannelPairing($input: StartWeChatAgentChannelPairingInput!) {\n    startWeChatAgentChannelPairing(input: $input) {\n      ...WeChatAgentChannelPairingFields\n    }\n  }\n": types.StartWeChatAgentChannelPairingDocument,
    "\n  mutation PollWeChatAgentChannelPairing($input: PollWeChatAgentChannelPairingInput!) {\n    pollWeChatAgentChannelPairing(input: $input) {\n      ...WeChatAgentChannelPairingFields\n    }\n  }\n": types.PollWeChatAgentChannelPairingDocument,
    "\n  mutation DeleteAgentChannelBinding($input: DeleteAgentChannelBindingInput!) {\n    deleteAgentChannelBinding(input: $input) {\n      ok\n    }\n  }\n": types.DeleteAgentChannelBindingDocument,
    "\n  fragment AgentFields on Agent {\n    createdAt\n    description\n    id\n    kind\n    liveVersion {\n      ...AgentDeploymentVersionFields\n    }\n    model\n    name\n    appId\n    prompt\n    provider\n    runtimeId\n    skills {\n      ownerName\n      skillId\n      skillName\n      state\n    }\n    status\n    updatedAt\n    visibility\n  }\n": types.AgentFieldsFragmentDoc,
    "\n  fragment AgentToolSummaryFields on AgentToolSummary {\n    enabled\n    iconUrl\n    name\n    serverId\n  }\n": types.AgentToolSummaryFieldsFragmentDoc,
    "\n  fragment AgentDeploymentVersionFields on AgentDeploymentVersion {\n    agentId\n    createdAt\n    createdByAccountId\n    environmentId\n    id\n    isLive\n    kind\n    model\n    provider\n    runtimeId\n    summary\n    versionNumber\n  }\n": types.AgentDeploymentVersionFieldsFragmentDoc,
    "\n  fragment AgentOwnerFields on AgentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n": types.AgentOwnerFieldsFragmentDoc,
    "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n": types.CreateAgentDocument,
    "\n  mutation DeleteAgent($input: DeleteAgentInput!) {\n    deleteAgent(input: $input) {\n      ok\n    }\n  }\n": types.DeleteAgentDocument,
    "\n  query AccessibleAgents($appId: ULID!) {\n    accessibleAgentList(appId: $appId) {\n      createdAt\n      description\n      id\n      kind\n      name\n      appId\n      owner {\n        ...AgentOwnerFields\n      }\n      runtimeId\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      viewerRole\n      visibility\n    }\n  }\n": types.AccessibleAgentsDocument,
    "\n  query Agent($agentId: ULID!, $appId: ULID!) {\n    agent(agentId: $agentId, appId: $appId) {\n      createdAt\n      description\n      id\n      kind\n      liveVersion {\n        ...AgentDeploymentVersionFields\n      }\n      model\n      name\n      appId\n      owner {\n        ...AgentOwnerFields\n      }\n      prompt\n      provider\n      runtimeId\n      skills {\n        ownerName\n        skillId\n        skillName\n        state\n      }\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      versions {\n        ...AgentDeploymentVersionFields\n      }\n      viewerRole\n      visibility\n    }\n  }\n": types.AgentDocument,
    "\n  query AgentEditorState($agentId: ULID!, $appId: ULID!) {\n    agentEditorState(agentId: $agentId, appId: $appId) {\n      id\n      builtInTools {\n        enabled\n        name\n      }\n      environment {\n        environmentId\n      }\n      packageResolution {\n        recordedAt\n        source\n        report {\n          issues {\n            actionLabel\n            code\n            message\n            required\n            severity\n            status\n            targetLabel\n            targetType\n          }\n          summary {\n            boundMcpServerCount\n            boundSkillCount\n            copiedAssetCount\n            createdMcpServerCount\n            reusedMcpServerCount\n          }\n        }\n      }\n      providerOptions\n      mcpBindings {\n        authType\n        authorizationState\n        createdAt\n        credentialMode\n        credentialScope\n        credentialStatus\n        credentialSubject\n        enabled\n        hasCredential\n        iconUrl\n        id\n        name\n        serverId\n        source\n        updatedAt\n        url\n      }\n      readiness {\n        checkedAt\n        ready\n        issues {\n          code\n          message\n          severity\n        }\n      }\n    }\n  }\n": types.AgentEditorStateDocument,
    "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      ...AgentFields\n    }\n  }\n": types.UpdateAgentConfigDocument,
    "\n  query AgentManifest($agentId: ULID!, $appId: ULID!) {\n    agentManifest(agentId: $agentId, appId: $appId) {\n      agentId\n      json\n      yaml\n    }\n  }\n": types.AgentManifestDocument,
    "\n  query ExportAgentPackage($agentId: ULID!, $appId: ULID!) {\n    exportAgentPackage(agentId: $agentId, appId: $appId) {\n      agentId\n      contentType\n      fileId\n      fileName\n      manifestYaml\n      size\n    }\n  }\n": types.ExportAgentPackageDocument,
    "\n  mutation ImportAgentPackage($input: ImportAgentPackageInput!) {\n    importAgentPackage(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n": types.ImportAgentPackageDocument,
    "\n  mutation CreateAgentFork($input: CreateAgentForkInput!) {\n    createAgentFork(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n": types.CreateAgentForkDocument,
    "\n  mutation PublishAgent($input: PublishAgentInput!) {\n    publishAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n": types.PublishAgentDocument,
    "\n  mutation UnpublishAgent($agentId: ULID!, $appId: ULID!) {\n    unpublishAgent(agentId: $agentId, appId: $appId) {\n      ...AgentFields\n    }\n  }\n": types.UnpublishAgentDocument,
    "\n  mutation RestartDriver($input: RuntimeStateOperationInput!) {\n    restartDriver(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": types.RestartDriverDocument,
    "\n  mutation RecreateSandbox($input: RuntimeStateOperationInput!) {\n    recreateSandbox(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": types.RecreateSandboxDocument,
    "\n  mutation ResetAgentState($input: RuntimeStateOperationInput!) {\n    resetAgentState(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": types.ResetAgentStateDocument,
    "\n  query AppList($organizationId: ULID!) {\n    appList(organizationId: $organizationId) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n": types.AppListDocument,
    "\n  mutation CreateApp($input: CreateAppInput!) {\n    createApp(input: $input) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n": types.CreateAppDocument,
    "\n  mutation RenameApp($input: RenameAppInput!) {\n    renameApp(input: $input) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n": types.RenameAppDocument,
    "\n  query AppDeploymentOverview($appId: ULID!) {\n    appOverview(appId: $appId) {\n      app {\n        id\n        name\n      }\n      boundAgents {\n        agentId\n        envVar\n        expose\n        name\n      }\n      deployment {\n        appId\n        createdAt\n        defaultBranch\n        id\n        liveUrl\n        plannedUrl\n        repoName\n        repoOwner\n        repoUrl\n        updatedAt\n        latestRun {\n          appId\n          createdAt\n          deploymentId\n          errorCode\n          errorMessage\n          id\n          liveUrl\n          plannedUrl\n          sourceBranch\n          sourceCommitSha\n          status\n          targetKind\n          updatedAt\n        }\n      }\n    }\n  }\n": types.AppDeploymentOverviewDocument,
    "\n  query AppDeploymentRunList($appId: ULID!, $limit: Int) {\n    appDeploymentRunList(appId: $appId, limit: $limit) {\n      appId\n      createdAt\n      deploymentId\n      errorCode\n      errorMessage\n      id\n      liveUrl\n      plannedUrl\n      sourceBranch\n      sourceCommitSha\n      status\n      targetKind\n      updatedAt\n    }\n  }\n": types.AppDeploymentRunListDocument,
    "\n  mutation DeployApp($input: DeployAppInput!) {\n    deployApp(input: $input) {\n      appId\n      createdAt\n      deploymentId\n      errorCode\n      errorMessage\n      id\n      liveUrl\n      plannedUrl\n      sourceBranch\n      sourceCommitSha\n      status\n      targetKind\n      updatedAt\n    }\n  }\n": types.DeployAppDocument,
    "\n  mutation DeleteAppDeployment($input: DeleteAppDeploymentInput!) {\n    deleteAppDeployment(input: $input) {\n      ok\n    }\n  }\n": types.DeleteAppDeploymentDocument,
    "\n  fragment CostTotalsFields on CostAggregate {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n": types.CostTotalsFieldsFragmentDoc,
    "\n  fragment CostDailyFields on CostDailyPoint {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    date\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n": types.CostDailyFieldsFragmentDoc,
    "\n  fragment CostAgentFields on CostAgentRow {\n    activeUsers\n    agentId\n    agentName\n    cacheCreationTokens\n    cacheReadTokens\n    debugCostUsd\n    evalCostUsd\n    inputTokens\n    outputTokens\n    ownerEmail\n    ownerId\n    ownerName\n    previousCostUsd\n    previewCostUsd\n    productionCostUsd\n    requestCount\n    scheduledCostUsd\n    totalCostUsd\n    unpricedRequestCount\n  }\n": types.CostAgentFieldsFragmentDoc,
    "\n  fragment CostModelFields on CostModelRow {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    cacheReadUsdPerMillion\n    cacheWriteUsdPerMillion\n    inputTokens\n    inputUsdPerMillion\n    model\n    outputTokens\n    outputUsdPerMillion\n    provider\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n    vendor\n  }\n": types.CostModelFieldsFragmentDoc,
    "\n  fragment CostRecentSessionFields on CostRecentSession {\n    actorEmail\n    actorName\n    cacheCreationTokens\n    cacheReadTokens\n    createdAt\n    inputTokens\n    model\n    outputTokens\n    provider\n    runPurpose\n    sessionId\n    sessionRunId\n    totalCostUsd\n  }\n": types.CostRecentSessionFieldsFragmentDoc,
    "\n  fragment CostAttributionFields on CostAttributionCard {\n    agents {\n      ...CostAgentFields\n    }\n    daily {\n      ...CostDailyFields\n    }\n    models {\n      ...CostModelFields\n    }\n    recentSessions {\n      ...CostRecentSessionFields\n    }\n    totals {\n      ...CostTotalsFields\n    }\n  }\n": types.CostAttributionFieldsFragmentDoc,
    "\n  query AppCostCard($appId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {\n    appCostCard(appId: $appId, range: $range, runPurposes: $runPurposes) {\n      appId\n      appName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      previousTotals {\n        ...CostTotalsFields\n      }\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n    }\n  }\n": types.AppCostCardDocument,
    "\n  query AgentCostCard(\n    $appId: ULID!\n    $agentId: ULID!\n    $range: CostRange!\n    $runPurposes: [CostRunPurpose!]\n  ) {\n    agentCostCard(appId: $appId, agentId: $agentId, range: $range, runPurposes: $runPurposes) {\n      agentId\n      agentName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerId\n      ownerName\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n    }\n  }\n": types.AgentCostCardDocument,
    "\n  fragment EnvironmentPackageFields on EnvironmentPackageSpec {\n    manager\n    packages\n  }\n": types.EnvironmentPackageFieldsFragmentDoc,
    "\n  fragment EnvironmentVariableFields on EnvironmentVariablePreview {\n    key\n    preview\n    status\n  }\n": types.EnvironmentVariableFieldsFragmentDoc,
    "\n  fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n": types.EnvironmentOwnerFieldsFragmentDoc,
    "\n  fragment EnvironmentSummaryFields on EnvironmentSummary {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    appId\n  }\n": types.EnvironmentSummaryFieldsFragmentDoc,
    "\n  fragment EnvironmentDetailFields on EnvironmentDetail {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    appId\n  }\n": types.EnvironmentDetailFieldsFragmentDoc,
    "\n  query AppEnvironments($appId: ULID!) {\n    appEnvironmentList(appId: $appId) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": types.AppEnvironmentsDocument,
    "\n  query EnvironmentDetail($appId: ULID!, $environmentId: ULID!) {\n    environment(appId: $appId, environmentId: $environmentId) {\n      ...EnvironmentDetailFields\n    }\n  }\n": types.EnvironmentDetailDocument,
    "\n  mutation CreateEnvironment($input: CreateEnvironmentInput!) {\n    createEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": types.CreateEnvironmentDocument,
    "\n  mutation UpdateEnvironment($input: UpdateEnvironmentInput!) {\n    updateEnvironment(input: $input) {\n      ...EnvironmentDetailFields\n    }\n  }\n": types.UpdateEnvironmentDocument,
    "\n  mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {\n    deleteEnvironment(input: $input) {\n      ok\n    }\n  }\n": types.DeleteEnvironmentDocument,
    "\n  mutation SetAppDefaultEnvironment($input: SetAppDefaultEnvironmentInput!) {\n    setAppDefaultEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": types.SetAppDefaultEnvironmentDocument,
    "\n  query FileList($input: FileListInput!) {\n    fileList(input: $input) {\n      files {\n        createdAt\n        createdBy\n        etag\n        expiresAt\n        id\n        mimeType\n        name\n        path\n        sessionKind\n        size\n        status\n        updatedAt\n        version\n      }\n    }\n  }\n": types.FileListDocument,
    "\n  fragment McpCredentialFields on McpCredentialSummary {\n    authType\n    createdAt\n    expiresAt\n    id\n    scope\n    scopeValues\n    status\n    subjectLabel\n    updatedAt\n  }\n": types.McpCredentialFieldsFragmentDoc,
    "\n  fragment McpServerFields on McpServerWithCredential {\n    authType\n    authorizationState\n    createdAt\n    credentialScope\n    credentialStatus\n    description\n    enabled\n    hasCredential\n    iconUrl\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    source\n    updatedAt\n    url\n    credential {\n      ...McpCredentialFields\n    }\n  }\n": types.McpServerFieldsFragmentDoc,
    "\n  query McpRegistry($appId: ULID!) {\n    mcpRegistry(appId: $appId) {\n      currentUserEmail\n      currentUserId\n      currentUserName\n      appId\n      servers {\n        ...McpServerFields\n      }\n    }\n  }\n": types.McpRegistryDocument,
    "\n  mutation CreateAppMcpServer($input: CreateAppMcpServerInput!) {\n    createAppMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": types.CreateAppMcpServerDocument,
    "\n  mutation ConnectMcpBearer($input: ConnectMcpBearerInput!) {\n    connectMcpBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": types.ConnectMcpBearerDocument,
    "\n  mutation RevokeMcpCredential($appId: ULID!, $serverId: ULID!) {\n    revokeMcpCredential(appId: $appId, serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n": types.RevokeMcpCredentialDocument,
    "\n  mutation SetMcpServerEnabled($appId: ULID!, $serverId: ULID!, $enabled: Boolean!) {\n    setMcpServerEnabled(appId: $appId, serverId: $serverId, enabled: $enabled) {\n      ...McpServerFields\n    }\n  }\n": types.SetMcpServerEnabledDocument,
    "\n  mutation UpdateAppMcpServer($input: UpdateAppMcpServerInput!) {\n    updateAppMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": types.UpdateAppMcpServerDocument,
    "\n  mutation DeleteMcpServer($appId: ULID!, $serverId: ULID!) {\n    deleteMcpServer(appId: $appId, serverId: $serverId) {\n      ok\n    }\n  }\n": types.DeleteMcpServerDocument,
    "\n  mutation StartMcpOAuth($input: StartMcpOAuthInput!) {\n    startMcpOAuth(input: $input) {\n      authorizationUrl\n      flowId\n    }\n  }\n": types.StartMcpOAuthDocument,
    "\n  query McpOAuthFlowStatus($flowId: ULID!) {\n    mcpOAuthFlowStatus(flowId: $flowId) {\n      authorizationState\n      errorMessage\n      flowId\n      serverId\n      status\n      subjectLabel\n    }\n  }\n": types.McpOAuthFlowStatusDocument,
    "\n  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {\n    onboardingBootstrap(input: $input) {\n      completed\n      organization {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n    }\n  }\n": types.OnboardingBootstrapDocument,
    "\n  mutation RenameOrganization($input: RenameOrganizationInput!) {\n    renameOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      name\n    }\n  }\n": types.RenameOrganizationDocument,
    "\n  query ThreadAgentSessionRetrieve($appId: ULID!, $sessionId: ULID!) {\n    threadAgentSessionRetrieve(appId: $appId, sessionId: $sessionId) {\n      capabilities {\n        action\n        reason\n        status\n      }\n      recoverability {\n        reason\n        status\n      }\n      session {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        appId\n        runtimeId\n        status\n        title\n        updatedAt\n      }\n    }\n  }\n": types.ThreadAgentSessionRetrieveDocument,
    "\n  query AgentSessionDiagnostics($appId: ULID!, $sessionId: ULID!) {\n    agentSessionDiagnostics(appId: $appId, sessionId: $sessionId) {\n      execution {\n        binding {\n          deploymentVersionId\n          deploymentVersionNumber\n          kind\n          model\n          provider\n          runtimeId\n          sessionId\n        }\n        skills {\n          skillId\n          skillName\n        }\n        tools {\n          credentialMode\n          serverId\n        }\n      }\n      generatedAt\n      nativeRuntimeRef {\n        kind\n        runtimeId\n        status\n        valuePreview\n      }\n      pendingPermissionCount\n      session {\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastRun {\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          model\n          provider\n          status\n          traceId\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n      }\n    }\n  }\n": types.AgentSessionDiagnosticsDocument,
    "\n  mutation CreateAgentSession($input: CreateAgentSessionInput!) {\n    createAgentSession(input: $input) {\n      agentId\n      archivedAt\n      createdAt\n      deploymentVersionId\n      deploymentVersionNumber\n      id\n      kind\n      lastMessageAt\n      lastRun {\n        completedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        error {\n          code\n          details\n          message\n          retryable\n        }\n        id\n        model\n        provider\n        startedAt\n        status\n        traceId\n        trigger\n        updatedAt\n      }\n      model\n      provider\n      appId\n      runtimeId\n      status\n      title\n      type\n      updatedAt\n    }\n  }\n": types.CreateAgentSessionDocument,
    "\n  query AgentSessionList(\n    $agentId: ULID!\n    $archived: Boolean\n    $participantOnly: Boolean\n    $appId: ULID!\n    $type: SessionType\n  ) {\n    agentSessionList(\n      agentId: $agentId\n      archived: $archived\n      participantOnly: $participantOnly\n      appId: $appId\n      type: $type\n    ) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        appId\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n      }\n    }\n  }\n": types.AgentSessionListDocument,
    "\n  query AgentSessionProcessEvents($limit: Int!, $appId: ULID!, $sessionId: ULID!) {\n    sessionProcessEvents(limit: $limit, appId: $appId, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n": types.AgentSessionProcessEventsDocument,
    "\n  query ThreadSessionMessages($appId: ULID!, $sessionId: ULID!) {\n    threadSessionMessages(appId: $appId, sessionId: $sessionId) {\n      content\n      createdAt\n      createdBy\n      id\n      plan {\n        content\n        priority\n        status\n      }\n      role\n      segments {\n        argsText\n        kind\n        output\n        path\n        text\n        tool\n        toolCallId\n      }\n    }\n  }\n": types.ThreadSessionMessagesDocument,
    "\n  mutation SendAgentSessionEvents(\n    $appId: ULID!\n    $sessionId: ULID!\n    $events: [AgentSessionEventInput!]!\n  ) {\n    sendAgentSessionEvents(appId: $appId, sessionId: $sessionId, events: $events) {\n      acceptedAt\n      warnings {\n        code\n        message\n      }\n    }\n  }\n": types.SendAgentSessionEventsDocument,
    "\n  mutation PrewarmAgentSession($appId: ULID!, $sessionId: ULID!) {\n    prewarmAgentSession(appId: $appId, sessionId: $sessionId) {\n      scheduledAt\n      sessionId\n    }\n  }\n": types.PrewarmAgentSessionDocument,
    "\n  query ThreadAgentSessionList($appId: ULID!, $archived: Boolean, $type: SessionType) {\n    threadAgentSessionList(appId: $appId, archived: $archived, type: $type) {\n      nodes {\n        capabilities {\n          action\n          reason\n          status\n        }\n        session {\n          agentId\n          archivedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          kind\n          lastMessageAt\n          lastRun {\n            completedAt\n            createdAt\n            deploymentVersionId\n            deploymentVersionNumber\n            error {\n              code\n              details\n              message\n              retryable\n            }\n            id\n            model\n            provider\n            startedAt\n            status\n            traceId\n            trigger\n            updatedAt\n          }\n          model\n          provider\n          appId\n          runtimeId\n          status\n          title\n          type\n          updatedAt\n        }\n      }\n    }\n  }\n": types.ThreadAgentSessionListDocument,
    "\n  mutation AutoTitleSession($input: RenameSessionInput!) {\n    autoTitleSession(input: $input) {\n      id\n    }\n  }\n": types.AutoTitleSessionDocument,
    "\n  mutation ArchiveSession($appId: ULID!, $sessionId: ULID!) {\n    archiveAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n": types.ArchiveSessionDocument,
    "\n  mutation RestoreSession($appId: ULID!, $sessionId: ULID!) {\n    unarchiveAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n": types.RestoreSessionDocument,
    "\n  mutation DeleteAgentSession($appId: ULID!, $sessionId: ULID!) {\n    deleteAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n": types.DeleteAgentSessionDocument,
    "\n  mutation AddSessionResource($input: AddSessionResourceInput!) {\n    addSessionResource(input: $input) {\n      contentType\n      expectedSize\n      expiresAt\n      fileId\n      partSize\n      path\n      status\n      strategy\n    }\n  }\n": types.AddSessionResourceDocument,
    "\n  query SessionProcessEvents($limit: Int!, $appId: ULID!, $sessionId: ULID!) {\n    threadSessionProcessEvents(limit: $limit, appId: $appId, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n": types.SessionProcessEventsDocument,
    "\n  fragment SkillSummaryFields on SkillSummary {\n    author\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    snapshotId\n    sourceKind\n    updatedAt\n  }\n": types.SkillSummaryFieldsFragmentDoc,
    "\n  fragment SkillDetailFields on SkillDetail {\n    author\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    snapshotId\n    sourceKind\n    updatedAt\n    currentSnapshot {\n      archiveFormat\n      author\n      blobKey\n      blobSha256\n      blobSize\n      compression\n      createdAt\n      description\n      id\n      name\n      skillMarkdownPath\n      uncompressedSize\n      version\n    }\n    entries {\n      entryKind\n      isExecutable\n      mimeType\n      path\n      sha256\n      size\n    }\n  }\n": types.SkillDetailFieldsFragmentDoc,
    "\n  query SkillDetail($appId: ULID!, $skillId: ULID!) {\n    skillDetail(appId: $appId, skillId: $skillId) {\n      ...SkillDetailFields\n    }\n  }\n": types.SkillDetailDocument,
    "\n  query AppSkills($appId: ULID!) {\n    appSkillList(appId: $appId) {\n      ...SkillSummaryFields\n    }\n  }\n": types.AppSkillsDocument,
    "\n  mutation CreateSkillFork($input: CreateSkillForkInput!) {\n    createSkillFork(input: $input) {\n      ...SkillSummaryFields\n    }\n  }\n": types.CreateSkillForkDocument,
    "\n  mutation DeleteOwnedSkill($appId: ULID!, $skillId: ULID!) {\n    deleteOwnedSkill(appId: $appId, skillId: $skillId) {\n      ok\n    }\n  }\n": types.DeleteOwnedSkillDocument,
    "\n  query Viewer {\n    viewer {\n      account {\n        email\n        id\n        imageUrl\n        name\n        systemAgentModel {\n          modelId\n          vendor\n        }\n      }\n      activeOrganization {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n      auth {\n        currentSecurityLevel\n        methods\n      }\n      organizations {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n    }\n  }\n": types.ViewerDocument,
    "\n  mutation UpdateProfile($input: UpdateAccountProfileInput!) {\n    updateProfile(input: $input) {\n      imageUrl\n      name\n    }\n  }\n": types.UpdateProfileDocument,
    "\n  query VendorCredentialList($appId: ULID!) {\n    vendorCredentialList(appId: $appId) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n": types.VendorCredentialListDocument,
    "\n  mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {\n    createVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n": types.CreateVendorCredentialDocument,
    "\n  mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {\n    updateVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n": types.UpdateVendorCredentialDocument,
    "\n  mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {\n    deleteVendorCredential(input: $input) {\n      ok\n    }\n  }\n": types.DeleteVendorCredentialDocument,
    "\n  mutation SetDefaultVendorCredential($input: SetDefaultVendorCredentialInput!) {\n    setDefaultVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n": types.SetDefaultVendorCredentialDocument,
    "\n  query AvailableAgentModels(\n    $appId: ULID!\n    $runtimeId: String!\n    $currentModelId: String\n    $currentVendorId: String\n  ) {\n    availableAgentModels(\n      appId: $appId\n      runtimeId: $runtimeId\n      currentModelId: $currentModelId\n      currentVendorId: $currentVendorId\n    ) {\n      available\n      displayName\n      modelId\n      reason\n      source\n      statusDetail\n      statusLabel\n      vendorId\n      vendorLabel\n    }\n  }\n": types.AvailableAgentModelsDocument,
    "\n  mutation TestVendorCredential($input: TestVendorCredentialInput!) {\n    testVendorCredential(input: $input) {\n      errorCode\n      latencyMs\n      ok\n    }\n  }\n": types.TestVendorCredentialDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentChannelBindingFields on AgentChannelBinding {\n    activityLastTriggeredAt\n    activitySessionCount7d\n    agentId\n    createdAt\n    displayMetadata\n    externalBotId\n    externalTenantId\n    id\n    lastErrorCode\n    provider\n    status\n    updatedAt\n  }\n"): typeof import('./graphql').AgentChannelBindingFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentChannelBindings($appId: ULID!, $agentId: ULID!) {\n    agentChannelBindingList(appId: $appId, agentId: $agentId) {\n      ...AgentChannelBindingFields\n    }\n  }\n"): typeof import('./graphql').AgentChannelBindingsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateSlackAgentChannelBinding($input: CreateSlackAgentChannelBindingInput!) {\n    createSlackAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n"): typeof import('./graphql').CreateSlackAgentChannelBindingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateLarkAgentChannelBinding($input: CreateLarkAgentChannelBindingInput!) {\n    createLarkAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n"): typeof import('./graphql').CreateLarkAgentChannelBindingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment LarkAgentChannelRegistrationFields on LarkAgentChannelRegistration {\n    appId\n    appSecret\n    deviceCode\n    domain\n    expireIn\n    interval\n    lastErrorCode\n    openId\n    qrUrl\n    status\n    userCode\n  }\n"): typeof import('./graphql').LarkAgentChannelRegistrationFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartLarkAgentChannelRegistration($input: StartLarkAgentChannelRegistrationInput!) {\n    startLarkAgentChannelRegistration(input: $input) {\n      ...LarkAgentChannelRegistrationFields\n    }\n  }\n"): typeof import('./graphql').StartLarkAgentChannelRegistrationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PollLarkAgentChannelRegistration($input: PollLarkAgentChannelRegistrationInput!) {\n    pollLarkAgentChannelRegistration(input: $input) {\n      ...LarkAgentChannelRegistrationFields\n    }\n  }\n"): typeof import('./graphql').PollLarkAgentChannelRegistrationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateTelegramAgentChannelBinding($input: CreateTelegramAgentChannelBindingInput!) {\n    createTelegramAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n"): typeof import('./graphql').CreateTelegramAgentChannelBindingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateDiscordAgentChannelBinding($input: CreateDiscordAgentChannelBindingInput!) {\n    createDiscordAgentChannelBinding(input: $input) {\n      ...AgentChannelBindingFields\n    }\n  }\n"): typeof import('./graphql').CreateDiscordAgentChannelBindingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment WeChatAgentChannelPairingFields on WeChatAgentChannelPairing {\n    binding {\n      ...AgentChannelBindingFields\n    }\n    lastErrorCode\n    qrCodeImageSrc\n    qrToken\n    status\n  }\n"): typeof import('./graphql').WeChatAgentChannelPairingFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartWeChatAgentChannelPairing($input: StartWeChatAgentChannelPairingInput!) {\n    startWeChatAgentChannelPairing(input: $input) {\n      ...WeChatAgentChannelPairingFields\n    }\n  }\n"): typeof import('./graphql').StartWeChatAgentChannelPairingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PollWeChatAgentChannelPairing($input: PollWeChatAgentChannelPairingInput!) {\n    pollWeChatAgentChannelPairing(input: $input) {\n      ...WeChatAgentChannelPairingFields\n    }\n  }\n"): typeof import('./graphql').PollWeChatAgentChannelPairingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteAgentChannelBinding($input: DeleteAgentChannelBindingInput!) {\n    deleteAgentChannelBinding(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteAgentChannelBindingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentFields on Agent {\n    createdAt\n    description\n    id\n    kind\n    liveVersion {\n      ...AgentDeploymentVersionFields\n    }\n    model\n    name\n    appId\n    prompt\n    provider\n    runtimeId\n    skills {\n      ownerName\n      skillId\n      skillName\n      state\n    }\n    status\n    updatedAt\n    visibility\n  }\n"): typeof import('./graphql').AgentFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentToolSummaryFields on AgentToolSummary {\n    enabled\n    iconUrl\n    name\n    serverId\n  }\n"): typeof import('./graphql').AgentToolSummaryFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentDeploymentVersionFields on AgentDeploymentVersion {\n    agentId\n    createdAt\n    createdByAccountId\n    environmentId\n    id\n    isLive\n    kind\n    model\n    provider\n    runtimeId\n    summary\n    versionNumber\n  }\n"): typeof import('./graphql').AgentDeploymentVersionFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentOwnerFields on AgentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n"): typeof import('./graphql').AgentOwnerFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n"): typeof import('./graphql').CreateAgentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteAgent($input: DeleteAgentInput!) {\n    deleteAgent(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteAgentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AccessibleAgents($appId: ULID!) {\n    accessibleAgentList(appId: $appId) {\n      createdAt\n      description\n      id\n      kind\n      name\n      appId\n      owner {\n        ...AgentOwnerFields\n      }\n      runtimeId\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      viewerRole\n      visibility\n    }\n  }\n"): typeof import('./graphql').AccessibleAgentsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Agent($agentId: ULID!, $appId: ULID!) {\n    agent(agentId: $agentId, appId: $appId) {\n      createdAt\n      description\n      id\n      kind\n      liveVersion {\n        ...AgentDeploymentVersionFields\n      }\n      model\n      name\n      appId\n      owner {\n        ...AgentOwnerFields\n      }\n      prompt\n      provider\n      runtimeId\n      skills {\n        ownerName\n        skillId\n        skillName\n        state\n      }\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      versions {\n        ...AgentDeploymentVersionFields\n      }\n      viewerRole\n      visibility\n    }\n  }\n"): typeof import('./graphql').AgentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentEditorState($agentId: ULID!, $appId: ULID!) {\n    agentEditorState(agentId: $agentId, appId: $appId) {\n      id\n      builtInTools {\n        enabled\n        name\n      }\n      environment {\n        environmentId\n      }\n      packageResolution {\n        recordedAt\n        source\n        report {\n          issues {\n            actionLabel\n            code\n            message\n            required\n            severity\n            status\n            targetLabel\n            targetType\n          }\n          summary {\n            boundMcpServerCount\n            boundSkillCount\n            copiedAssetCount\n            createdMcpServerCount\n            reusedMcpServerCount\n          }\n        }\n      }\n      providerOptions\n      mcpBindings {\n        authType\n        authorizationState\n        createdAt\n        credentialMode\n        credentialScope\n        credentialStatus\n        credentialSubject\n        enabled\n        hasCredential\n        iconUrl\n        id\n        name\n        serverId\n        source\n        updatedAt\n        url\n      }\n      readiness {\n        checkedAt\n        ready\n        issues {\n          code\n          message\n          severity\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').AgentEditorStateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      ...AgentFields\n    }\n  }\n"): typeof import('./graphql').UpdateAgentConfigDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentManifest($agentId: ULID!, $appId: ULID!) {\n    agentManifest(agentId: $agentId, appId: $appId) {\n      agentId\n      json\n      yaml\n    }\n  }\n"): typeof import('./graphql').AgentManifestDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ExportAgentPackage($agentId: ULID!, $appId: ULID!) {\n    exportAgentPackage(agentId: $agentId, appId: $appId) {\n      agentId\n      contentType\n      fileId\n      fileName\n      manifestYaml\n      size\n    }\n  }\n"): typeof import('./graphql').ExportAgentPackageDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ImportAgentPackage($input: ImportAgentPackageInput!) {\n    importAgentPackage(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').ImportAgentPackageDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateAgentFork($input: CreateAgentForkInput!) {\n    createAgentFork(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').CreateAgentForkDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PublishAgent($input: PublishAgentInput!) {\n    publishAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n"): typeof import('./graphql').PublishAgentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnpublishAgent($agentId: ULID!, $appId: ULID!) {\n    unpublishAgent(agentId: $agentId, appId: $appId) {\n      ...AgentFields\n    }\n  }\n"): typeof import('./graphql').UnpublishAgentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RestartDriver($input: RuntimeStateOperationInput!) {\n    restartDriver(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n"): typeof import('./graphql').RestartDriverDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RecreateSandbox($input: RuntimeStateOperationInput!) {\n    recreateSandbox(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n"): typeof import('./graphql').RecreateSandboxDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ResetAgentState($input: RuntimeStateOperationInput!) {\n    resetAgentState(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n"): typeof import('./graphql').ResetAgentStateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AppList($organizationId: ULID!) {\n    appList(organizationId: $organizationId) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n"): typeof import('./graphql').AppListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateApp($input: CreateAppInput!) {\n    createApp(input: $input) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n"): typeof import('./graphql').CreateAppDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RenameApp($input: RenameAppInput!) {\n    renameApp(input: $input) {\n      createdAt\n      defaultEnvironmentId\n      id\n      name\n      ownerAccountId\n    }\n  }\n"): typeof import('./graphql').RenameAppDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AppDeploymentOverview($appId: ULID!) {\n    appOverview(appId: $appId) {\n      app {\n        id\n        name\n      }\n      boundAgents {\n        agentId\n        envVar\n        expose\n        name\n      }\n      deployment {\n        appId\n        createdAt\n        defaultBranch\n        id\n        liveUrl\n        plannedUrl\n        repoName\n        repoOwner\n        repoUrl\n        updatedAt\n        latestRun {\n          appId\n          createdAt\n          deploymentId\n          errorCode\n          errorMessage\n          id\n          liveUrl\n          plannedUrl\n          sourceBranch\n          sourceCommitSha\n          status\n          targetKind\n          updatedAt\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').AppDeploymentOverviewDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AppDeploymentRunList($appId: ULID!, $limit: Int) {\n    appDeploymentRunList(appId: $appId, limit: $limit) {\n      appId\n      createdAt\n      deploymentId\n      errorCode\n      errorMessage\n      id\n      liveUrl\n      plannedUrl\n      sourceBranch\n      sourceCommitSha\n      status\n      targetKind\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').AppDeploymentRunListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeployApp($input: DeployAppInput!) {\n    deployApp(input: $input) {\n      appId\n      createdAt\n      deploymentId\n      errorCode\n      errorMessage\n      id\n      liveUrl\n      plannedUrl\n      sourceBranch\n      sourceCommitSha\n      status\n      targetKind\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').DeployAppDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteAppDeployment($input: DeleteAppDeploymentInput!) {\n    deleteAppDeployment(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteAppDeploymentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CostTotalsFields on CostAggregate {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n"): typeof import('./graphql').CostTotalsFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CostDailyFields on CostDailyPoint {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    date\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n"): typeof import('./graphql').CostDailyFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CostAgentFields on CostAgentRow {\n    activeUsers\n    agentId\n    agentName\n    cacheCreationTokens\n    cacheReadTokens\n    debugCostUsd\n    evalCostUsd\n    inputTokens\n    outputTokens\n    ownerEmail\n    ownerId\n    ownerName\n    previousCostUsd\n    previewCostUsd\n    productionCostUsd\n    requestCount\n    scheduledCostUsd\n    totalCostUsd\n    unpricedRequestCount\n  }\n"): typeof import('./graphql').CostAgentFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CostModelFields on CostModelRow {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    cacheReadUsdPerMillion\n    cacheWriteUsdPerMillion\n    inputTokens\n    inputUsdPerMillion\n    model\n    outputTokens\n    outputUsdPerMillion\n    provider\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n    vendor\n  }\n"): typeof import('./graphql').CostModelFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CostRecentSessionFields on CostRecentSession {\n    actorEmail\n    actorName\n    cacheCreationTokens\n    cacheReadTokens\n    createdAt\n    inputTokens\n    model\n    outputTokens\n    provider\n    runPurpose\n    sessionId\n    sessionRunId\n    totalCostUsd\n  }\n"): typeof import('./graphql').CostRecentSessionFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CostAttributionFields on CostAttributionCard {\n    agents {\n      ...CostAgentFields\n    }\n    daily {\n      ...CostDailyFields\n    }\n    models {\n      ...CostModelFields\n    }\n    recentSessions {\n      ...CostRecentSessionFields\n    }\n    totals {\n      ...CostTotalsFields\n    }\n  }\n"): typeof import('./graphql').CostAttributionFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AppCostCard($appId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {\n    appCostCard(appId: $appId, range: $range, runPurposes: $runPurposes) {\n      appId\n      appName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      previousTotals {\n        ...CostTotalsFields\n      }\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n    }\n  }\n"): typeof import('./graphql').AppCostCardDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentCostCard(\n    $appId: ULID!\n    $agentId: ULID!\n    $range: CostRange!\n    $runPurposes: [CostRunPurpose!]\n  ) {\n    agentCostCard(appId: $appId, agentId: $agentId, range: $range, runPurposes: $runPurposes) {\n      agentId\n      agentName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerId\n      ownerName\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n    }\n  }\n"): typeof import('./graphql').AgentCostCardDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment EnvironmentPackageFields on EnvironmentPackageSpec {\n    manager\n    packages\n  }\n"): typeof import('./graphql').EnvironmentPackageFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment EnvironmentVariableFields on EnvironmentVariablePreview {\n    key\n    preview\n    status\n  }\n"): typeof import('./graphql').EnvironmentVariableFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n"): typeof import('./graphql').EnvironmentOwnerFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment EnvironmentSummaryFields on EnvironmentSummary {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    appId\n  }\n"): typeof import('./graphql').EnvironmentSummaryFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment EnvironmentDetailFields on EnvironmentDetail {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    appId\n  }\n"): typeof import('./graphql').EnvironmentDetailFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AppEnvironments($appId: ULID!) {\n    appEnvironmentList(appId: $appId) {\n      ...EnvironmentSummaryFields\n    }\n  }\n"): typeof import('./graphql').AppEnvironmentsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query EnvironmentDetail($appId: ULID!, $environmentId: ULID!) {\n    environment(appId: $appId, environmentId: $environmentId) {\n      ...EnvironmentDetailFields\n    }\n  }\n"): typeof import('./graphql').EnvironmentDetailDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateEnvironment($input: CreateEnvironmentInput!) {\n    createEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n"): typeof import('./graphql').CreateEnvironmentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateEnvironment($input: UpdateEnvironmentInput!) {\n    updateEnvironment(input: $input) {\n      ...EnvironmentDetailFields\n    }\n  }\n"): typeof import('./graphql').UpdateEnvironmentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {\n    deleteEnvironment(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteEnvironmentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetAppDefaultEnvironment($input: SetAppDefaultEnvironmentInput!) {\n    setAppDefaultEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n"): typeof import('./graphql').SetAppDefaultEnvironmentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query FileList($input: FileListInput!) {\n    fileList(input: $input) {\n      files {\n        createdAt\n        createdBy\n        etag\n        expiresAt\n        id\n        mimeType\n        name\n        path\n        sessionKind\n        size\n        status\n        updatedAt\n        version\n      }\n    }\n  }\n"): typeof import('./graphql').FileListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment McpCredentialFields on McpCredentialSummary {\n    authType\n    createdAt\n    expiresAt\n    id\n    scope\n    scopeValues\n    status\n    subjectLabel\n    updatedAt\n  }\n"): typeof import('./graphql').McpCredentialFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment McpServerFields on McpServerWithCredential {\n    authType\n    authorizationState\n    createdAt\n    credentialScope\n    credentialStatus\n    description\n    enabled\n    hasCredential\n    iconUrl\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    source\n    updatedAt\n    url\n    credential {\n      ...McpCredentialFields\n    }\n  }\n"): typeof import('./graphql').McpServerFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query McpRegistry($appId: ULID!) {\n    mcpRegistry(appId: $appId) {\n      currentUserEmail\n      currentUserId\n      currentUserName\n      appId\n      servers {\n        ...McpServerFields\n      }\n    }\n  }\n"): typeof import('./graphql').McpRegistryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateAppMcpServer($input: CreateAppMcpServerInput!) {\n    createAppMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').CreateAppMcpServerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ConnectMcpBearer($input: ConnectMcpBearerInput!) {\n    connectMcpBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').ConnectMcpBearerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RevokeMcpCredential($appId: ULID!, $serverId: ULID!) {\n    revokeMcpCredential(appId: $appId, serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').RevokeMcpCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetMcpServerEnabled($appId: ULID!, $serverId: ULID!, $enabled: Boolean!) {\n    setMcpServerEnabled(appId: $appId, serverId: $serverId, enabled: $enabled) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').SetMcpServerEnabledDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateAppMcpServer($input: UpdateAppMcpServerInput!) {\n    updateAppMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').UpdateAppMcpServerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteMcpServer($appId: ULID!, $serverId: ULID!) {\n    deleteMcpServer(appId: $appId, serverId: $serverId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteMcpServerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartMcpOAuth($input: StartMcpOAuthInput!) {\n    startMcpOAuth(input: $input) {\n      authorizationUrl\n      flowId\n    }\n  }\n"): typeof import('./graphql').StartMcpOAuthDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query McpOAuthFlowStatus($flowId: ULID!) {\n    mcpOAuthFlowStatus(flowId: $flowId) {\n      authorizationState\n      errorMessage\n      flowId\n      serverId\n      status\n      subjectLabel\n    }\n  }\n"): typeof import('./graphql').McpOAuthFlowStatusDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {\n    onboardingBootstrap(input: $input) {\n      completed\n      organization {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n    }\n  }\n"): typeof import('./graphql').OnboardingBootstrapDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RenameOrganization($input: RenameOrganizationInput!) {\n    renameOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      name\n    }\n  }\n"): typeof import('./graphql').RenameOrganizationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ThreadAgentSessionRetrieve($appId: ULID!, $sessionId: ULID!) {\n    threadAgentSessionRetrieve(appId: $appId, sessionId: $sessionId) {\n      capabilities {\n        action\n        reason\n        status\n      }\n      recoverability {\n        reason\n        status\n      }\n      session {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        appId\n        runtimeId\n        status\n        title\n        updatedAt\n      }\n    }\n  }\n"): typeof import('./graphql').ThreadAgentSessionRetrieveDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentSessionDiagnostics($appId: ULID!, $sessionId: ULID!) {\n    agentSessionDiagnostics(appId: $appId, sessionId: $sessionId) {\n      execution {\n        binding {\n          deploymentVersionId\n          deploymentVersionNumber\n          kind\n          model\n          provider\n          runtimeId\n          sessionId\n        }\n        skills {\n          skillId\n          skillName\n        }\n        tools {\n          credentialMode\n          serverId\n        }\n      }\n      generatedAt\n      nativeRuntimeRef {\n        kind\n        runtimeId\n        status\n        valuePreview\n      }\n      pendingPermissionCount\n      session {\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastRun {\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          model\n          provider\n          status\n          traceId\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n      }\n    }\n  }\n"): typeof import('./graphql').AgentSessionDiagnosticsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateAgentSession($input: CreateAgentSessionInput!) {\n    createAgentSession(input: $input) {\n      agentId\n      archivedAt\n      createdAt\n      deploymentVersionId\n      deploymentVersionNumber\n      id\n      kind\n      lastMessageAt\n      lastRun {\n        completedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        error {\n          code\n          details\n          message\n          retryable\n        }\n        id\n        model\n        provider\n        startedAt\n        status\n        traceId\n        trigger\n        updatedAt\n      }\n      model\n      provider\n      appId\n      runtimeId\n      status\n      title\n      type\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').CreateAgentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentSessionList(\n    $agentId: ULID!\n    $archived: Boolean\n    $participantOnly: Boolean\n    $appId: ULID!\n    $type: SessionType\n  ) {\n    agentSessionList(\n      agentId: $agentId\n      archived: $archived\n      participantOnly: $participantOnly\n      appId: $appId\n      type: $type\n    ) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        appId\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n      }\n    }\n  }\n"): typeof import('./graphql').AgentSessionListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentSessionProcessEvents($limit: Int!, $appId: ULID!, $sessionId: ULID!) {\n    sessionProcessEvents(limit: $limit, appId: $appId, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n"): typeof import('./graphql').AgentSessionProcessEventsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ThreadSessionMessages($appId: ULID!, $sessionId: ULID!) {\n    threadSessionMessages(appId: $appId, sessionId: $sessionId) {\n      content\n      createdAt\n      createdBy\n      id\n      plan {\n        content\n        priority\n        status\n      }\n      role\n      segments {\n        argsText\n        kind\n        output\n        path\n        text\n        tool\n        toolCallId\n      }\n    }\n  }\n"): typeof import('./graphql').ThreadSessionMessagesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SendAgentSessionEvents(\n    $appId: ULID!\n    $sessionId: ULID!\n    $events: [AgentSessionEventInput!]!\n  ) {\n    sendAgentSessionEvents(appId: $appId, sessionId: $sessionId, events: $events) {\n      acceptedAt\n      warnings {\n        code\n        message\n      }\n    }\n  }\n"): typeof import('./graphql').SendAgentSessionEventsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PrewarmAgentSession($appId: ULID!, $sessionId: ULID!) {\n    prewarmAgentSession(appId: $appId, sessionId: $sessionId) {\n      scheduledAt\n      sessionId\n    }\n  }\n"): typeof import('./graphql').PrewarmAgentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ThreadAgentSessionList($appId: ULID!, $archived: Boolean, $type: SessionType) {\n    threadAgentSessionList(appId: $appId, archived: $archived, type: $type) {\n      nodes {\n        capabilities {\n          action\n          reason\n          status\n        }\n        session {\n          agentId\n          archivedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          kind\n          lastMessageAt\n          lastRun {\n            completedAt\n            createdAt\n            deploymentVersionId\n            deploymentVersionNumber\n            error {\n              code\n              details\n              message\n              retryable\n            }\n            id\n            model\n            provider\n            startedAt\n            status\n            traceId\n            trigger\n            updatedAt\n          }\n          model\n          provider\n          appId\n          runtimeId\n          status\n          title\n          type\n          updatedAt\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').ThreadAgentSessionListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AutoTitleSession($input: RenameSessionInput!) {\n    autoTitleSession(input: $input) {\n      id\n    }\n  }\n"): typeof import('./graphql').AutoTitleSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveSession($appId: ULID!, $sessionId: ULID!) {\n    archiveAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').ArchiveSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RestoreSession($appId: ULID!, $sessionId: ULID!) {\n    unarchiveAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').RestoreSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteAgentSession($appId: ULID!, $sessionId: ULID!) {\n    deleteAgentSession(appId: $appId, sessionId: $sessionId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteAgentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddSessionResource($input: AddSessionResourceInput!) {\n    addSessionResource(input: $input) {\n      contentType\n      expectedSize\n      expiresAt\n      fileId\n      partSize\n      path\n      status\n      strategy\n    }\n  }\n"): typeof import('./graphql').AddSessionResourceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionProcessEvents($limit: Int!, $appId: ULID!, $sessionId: ULID!) {\n    threadSessionProcessEvents(limit: $limit, appId: $appId, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n"): typeof import('./graphql').SessionProcessEventsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SkillSummaryFields on SkillSummary {\n    author\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    snapshotId\n    sourceKind\n    updatedAt\n  }\n"): typeof import('./graphql').SkillSummaryFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SkillDetailFields on SkillDetail {\n    author\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    appId\n    snapshotId\n    sourceKind\n    updatedAt\n    currentSnapshot {\n      archiveFormat\n      author\n      blobKey\n      blobSha256\n      blobSize\n      compression\n      createdAt\n      description\n      id\n      name\n      skillMarkdownPath\n      uncompressedSize\n      version\n    }\n    entries {\n      entryKind\n      isExecutable\n      mimeType\n      path\n      sha256\n      size\n    }\n  }\n"): typeof import('./graphql').SkillDetailFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SkillDetail($appId: ULID!, $skillId: ULID!) {\n    skillDetail(appId: $appId, skillId: $skillId) {\n      ...SkillDetailFields\n    }\n  }\n"): typeof import('./graphql').SkillDetailDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AppSkills($appId: ULID!) {\n    appSkillList(appId: $appId) {\n      ...SkillSummaryFields\n    }\n  }\n"): typeof import('./graphql').AppSkillsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateSkillFork($input: CreateSkillForkInput!) {\n    createSkillFork(input: $input) {\n      ...SkillSummaryFields\n    }\n  }\n"): typeof import('./graphql').CreateSkillForkDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteOwnedSkill($appId: ULID!, $skillId: ULID!) {\n    deleteOwnedSkill(appId: $appId, skillId: $skillId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteOwnedSkillDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Viewer {\n    viewer {\n      account {\n        email\n        id\n        imageUrl\n        name\n        systemAgentModel {\n          modelId\n          vendor\n        }\n      }\n      activeOrganization {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n      auth {\n        currentSecurityLevel\n        methods\n      }\n      organizations {\n        avatarUrl\n        createdAt\n        id\n        name\n      }\n    }\n  }\n"): typeof import('./graphql').ViewerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateProfile($input: UpdateAccountProfileInput!) {\n    updateProfile(input: $input) {\n      imageUrl\n      name\n    }\n  }\n"): typeof import('./graphql').UpdateProfileDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query VendorCredentialList($appId: ULID!) {\n    vendorCredentialList(appId: $appId) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n"): typeof import('./graphql').VendorCredentialListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {\n    createVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n"): typeof import('./graphql').CreateVendorCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {\n    updateVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n"): typeof import('./graphql').UpdateVendorCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {\n    deleteVendorCredential(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteVendorCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetDefaultVendorCredential($input: SetDefaultVendorCredentialInput!) {\n    setDefaultVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      maskedApiKey\n      models\n      name\n      appId\n      vendorId\n    }\n  }\n"): typeof import('./graphql').SetDefaultVendorCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AvailableAgentModels(\n    $appId: ULID!\n    $runtimeId: String!\n    $currentModelId: String\n    $currentVendorId: String\n  ) {\n    availableAgentModels(\n      appId: $appId\n      runtimeId: $runtimeId\n      currentModelId: $currentModelId\n      currentVendorId: $currentVendorId\n    ) {\n      available\n      displayName\n      modelId\n      reason\n      source\n      statusDetail\n      statusLabel\n      vendorId\n      vendorLabel\n    }\n  }\n"): typeof import('./graphql').AvailableAgentModelsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation TestVendorCredential($input: TestVendorCredentialInput!) {\n    testVendorCredential(input: $input) {\n      errorCode\n      latencyMs\n      ok\n    }\n  }\n"): typeof import('./graphql').TestVendorCredentialDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
