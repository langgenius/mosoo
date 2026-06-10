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
    "\n  mutation EnsureAgentBuilderThread($agentId: ULID!) {\n    ensureAgentBuilderThread(agentId: $agentId) {\n      agentId\n      createdAt\n      creatorAccountId\n      id\n      lastTurnAt\n      organizationId\n      status\n      title\n      updatedAt\n    }\n  }\n": typeof types.EnsureAgentBuilderThreadDocument,
    "\n  mutation ExecuteAgentBuilderControlPlaneAction(\n    $input: ExecuteAgentBuilderControlPlaneActionInput!\n  ) {\n    executeAgentBuilderControlPlaneAction(input: $input) {\n      createdEnvironment {\n        id\n        name\n      }\n      createdMcpServer {\n        authType\n        id\n        name\n        url\n      }\n      message\n      secureUi {\n        kind\n        mcpServerId\n      }\n      sessionId\n      status\n      toolId\n    }\n  }\n": typeof types.ExecuteAgentBuilderControlPlaneActionDocument,
    "\n  query AgentBuilderMessages($agentId: ULID!, $beforeSeq: Int, $limit: Int) {\n    agentBuilderMessages(agentId: $agentId, beforeSeq: $beforeSeq, limit: $limit) {\n      cardsJson\n      contentText\n      createdAt\n      createdByAccountId\n      id\n      inputKind\n      plannerRunId\n      role\n      seq\n      threadId\n    }\n  }\n": typeof types.AgentBuilderMessagesDocument,
    "\n  fragment AgentChannelBindingFields on AgentChannelBinding {\n    activityLastTriggeredAt\n    activitySessionCount7d\n    agentId\n    createdAt\n    displayMetadata\n    externalBotId\n    externalTenantId\n    id\n    lastErrorCode\n    provider\n    status\n    updatedAt\n  }\n": typeof types.AgentChannelBindingFieldsFragmentDoc,
    "\n  query AgentChannelBindings($agentId: ULID!) {\n    agentChannelBindingList(agentId: $agentId) {\n      ...AgentChannelBindingFields\n    }\n  }\n": typeof types.AgentChannelBindingsDocument,
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
    "\n  mutation AddAgentCollaborator($input: AddAgentCollaboratorInput!) {\n    addAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n": typeof types.AddAgentCollaboratorDocument,
    "\n  mutation RemoveAgentCollaborator($input: RemoveAgentCollaboratorInput!) {\n    removeAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n": typeof types.RemoveAgentCollaboratorDocument,
    "\n  mutation UpdateAgentCollaborator($input: UpdateAgentCollaboratorInput!) {\n    updateAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n": typeof types.UpdateAgentCollaboratorDocument,
    "\n  fragment AgentFields on Agent {\n    createdAt\n    description\n    id\n    kind\n    liveVersion {\n      ...AgentDeploymentVersionFields\n    }\n    model\n    name\n    packageSharingEnabled\n    prompt\n    provider\n    runtimeId\n    skills {\n      ownerName\n      skillId\n      skillName\n      state\n    }\n    status\n    updatedAt\n    visibility\n    organizationId\n  }\n": typeof types.AgentFieldsFragmentDoc,
    "\n  fragment AgentToolSummaryFields on AgentToolSummary {\n    enabled\n    iconUrl\n    name\n    serverId\n  }\n": typeof types.AgentToolSummaryFieldsFragmentDoc,
    "\n  fragment AgentDeploymentVersionFields on AgentDeploymentVersion {\n    agentId\n    createdAt\n    createdByAccountId\n    environmentId\n    id\n    isLive\n    kind\n    model\n    provider\n    runtimeId\n    summary\n    versionNumber\n  }\n": typeof types.AgentDeploymentVersionFieldsFragmentDoc,
    "\n  fragment AgentOwnerFields on AgentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n": typeof types.AgentOwnerFieldsFragmentDoc,
    "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n": typeof types.CreateAgentDocument,
    "\n  mutation DeleteAgent($input: DeleteAgentInput!) {\n    deleteAgent(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteAgentDocument,
    "\n  query AccessibleAgents($organizationId: ULID!) {\n    accessibleAgentList(organizationId: $organizationId) {\n      createdAt\n      description\n      id\n      kind\n      name\n      owner {\n        ...AgentOwnerFields\n      }\n      runtimeId\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      viewerRole\n      visibility\n      organizationId\n    }\n  }\n": typeof types.AccessibleAgentsDocument,
    "\n  query Agent($agentId: ULID!) {\n    agent(agentId: $agentId) {\n      createdAt\n      description\n      id\n      kind\n      liveVersion {\n        ...AgentDeploymentVersionFields\n      }\n      model\n      name\n      owner {\n        ...AgentOwnerFields\n      }\n      packageSharingEnabled\n      prompt\n      provider\n      runtimeId\n      skills {\n        ownerName\n        skillId\n        skillName\n        state\n      }\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      versions {\n        ...AgentDeploymentVersionFields\n      }\n      viewerRole\n      visibility\n      organizationId\n    }\n  }\n": typeof types.AgentDocument,
    "\n  query AgentEditorState($agentId: ULID!) {\n    agentEditorState(agentId: $agentId) {\n      id\n      builder {\n        componentDecisions {\n          agentType\n          environment\n        }\n      }\n      environment {\n        boundSpaceIds\n        environmentId\n      }\n      packageResolution {\n        recordedAt\n        source\n        report {\n          issues {\n            actionLabel\n            code\n            message\n            required\n            severity\n            status\n            targetLabel\n            targetType\n          }\n          summary {\n            boundMcpServerCount\n            boundSkillCount\n            boundSpaceCount\n            copiedAssetCount\n            createdMcpServerCount\n            reusedMcpServerCount\n          }\n        }\n      }\n      collaborators {\n        principal\n        role\n        name\n        email\n        imageUrl\n      }\n      mcpBindings {\n        authType\n        authorizationState\n        createdAt\n        credentialMode\n        credentialScope\n        credentialStatus\n        credentialSubject\n        enabled\n        hasSharedCredential\n        iconUrl\n        id\n        name\n        serverId\n        source\n        updatedAt\n        url\n      }\n      readiness {\n        checkedAt\n        ready\n        issues {\n          code\n          message\n          severity\n        }\n      }\n    }\n  }\n": typeof types.AgentEditorStateDocument,
    "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      ...AgentFields\n    }\n  }\n": typeof types.UpdateAgentConfigDocument,
    "\n  fragment AgentFileSessionNodeFields on AgentFileSessionNode {\n    active\n    id\n    status\n    title\n    updatedAt\n  }\n": typeof types.AgentFileSessionNodeFieldsFragmentDoc,
    "\n  fragment AgentFileSpaceMountFields on AgentFileSpaceMountNode {\n    path\n    spaceId\n    spaceName\n    url\n  }\n": typeof types.AgentFileSpaceMountFieldsFragmentDoc,
    "\n  fragment AgentFileEntryFields on AgentFileEntry {\n    kind\n    mimeType\n    name\n    path\n    persistence\n    preview\n    session {\n      ...AgentFileSessionNodeFields\n    }\n    sizeBytes\n    space {\n      ...AgentFileSpaceMountFields\n    }\n  }\n": typeof types.AgentFileEntryFieldsFragmentDoc,
    "\n  query AgentFileTree($agentId: ULID!, $path: String!) {\n    agentFileTree(agentId: $agentId, path: $path) {\n      agentId\n      entries {\n        ...AgentFileEntryFields\n      }\n      lastError\n      path\n      sandboxId\n      sandboxStatus\n      totalCount\n      truncated\n    }\n  }\n": typeof types.AgentFileTreeDocument,
    "\n  query AgentFileContent($agentId: ULID!, $path: String!) {\n    agentFileContent(agentId: $agentId, path: $path) {\n      agentId\n      content\n      mimeType\n      name\n      path\n      preview\n      sandboxId\n      sizeBytes\n    }\n  }\n": typeof types.AgentFileContentDocument,
    "\n  query AgentManifest($agentId: ULID!) {\n    agentManifest(agentId: $agentId) {\n      agentId\n      json\n      yaml\n    }\n  }\n": typeof types.AgentManifestDocument,
    "\n  query ExportAgentPackage($agentId: ULID!) {\n    exportAgentPackage(agentId: $agentId) {\n      agentId\n      contentType\n      fileId\n      fileName\n      manifestYaml\n      size\n    }\n  }\n": typeof types.ExportAgentPackageDocument,
    "\n  mutation UpdateAgentPackageSharing($input: UpdateAgentPackageSharingInput!) {\n    updateAgentPackageSharing(input: $input) {\n      ...AgentFields\n    }\n  }\n": typeof types.UpdateAgentPackageSharingDocument,
    "\n  mutation ImportAgentPackage($input: ImportAgentPackageInput!) {\n    importAgentPackage(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          boundSpaceCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n": typeof types.ImportAgentPackageDocument,
    "\n  mutation CreateAgentFork($input: CreateAgentForkInput!) {\n    createAgentFork(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          boundSpaceCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n": typeof types.CreateAgentForkDocument,
    "\n  mutation PublishAgent($input: PublishAgentInput!) {\n    publishAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n": typeof types.PublishAgentDocument,
    "\n  mutation UnpublishAgent($agentId: ULID!) {\n    unpublishAgent(agentId: $agentId) {\n      ...AgentFields\n    }\n  }\n": typeof types.UnpublishAgentDocument,
    "\n  mutation RestartDriver($input: RuntimeStateOperationInput!) {\n    restartDriver(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": typeof types.RestartDriverDocument,
    "\n  mutation RecreateSandbox($input: RuntimeStateOperationInput!) {\n    recreateSandbox(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": typeof types.RecreateSandboxDocument,
    "\n  mutation ResetAgentState($input: RuntimeStateOperationInput!) {\n    resetAgentState(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": typeof types.ResetAgentStateDocument,
    "\n  fragment CostTotalsFields on CostAggregate {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n": typeof types.CostTotalsFieldsFragmentDoc,
    "\n  fragment CostDailyFields on CostDailyPoint {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    date\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n": typeof types.CostDailyFieldsFragmentDoc,
    "\n  fragment CostAgentFields on CostAgentRow {\n    activeUsers\n    agentId\n    agentName\n    cacheCreationTokens\n    cacheReadTokens\n    debugCostUsd\n    evalCostUsd\n    inputTokens\n    outputTokens\n    ownerEmail\n    ownerId\n    ownerName\n    previousCostUsd\n    previewCostUsd\n    productionCostUsd\n    requestCount\n    scheduledCostUsd\n    totalCostUsd\n    unpricedRequestCount\n  }\n": typeof types.CostAgentFieldsFragmentDoc,
    "\n  fragment CostModelFields on CostModelRow {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    cacheReadUsdPerMillion\n    cacheWriteUsdPerMillion\n    inputTokens\n    inputUsdPerMillion\n    model\n    outputTokens\n    outputUsdPerMillion\n    provider\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n    vendor\n  }\n": typeof types.CostModelFieldsFragmentDoc,
    "\n  fragment CostRecentSessionFields on CostRecentSession {\n    actorEmail\n    actorName\n    actorUserId\n    cacheCreationTokens\n    cacheReadTokens\n    createdAt\n    inputTokens\n    model\n    outputTokens\n    provider\n    runPurpose\n    sessionId\n    sessionRunId\n    totalCostUsd\n  }\n": typeof types.CostRecentSessionFieldsFragmentDoc,
    "\n  fragment CostAttributionFields on CostAttributionCard {\n    agents {\n      ...CostAgentFields\n    }\n    daily {\n      ...CostDailyFields\n    }\n    models {\n      ...CostModelFields\n    }\n    recentSessions {\n      ...CostRecentSessionFields\n    }\n    totals {\n      ...CostTotalsFields\n    }\n  }\n": typeof types.CostAttributionFieldsFragmentDoc,
    "\n  query OrganizationCostCard(\n    $organizationId: ULID!\n    $range: CostRange!\n    $runPurposes: [CostRunPurpose!]\n  ) {\n    organizationCostCard(\n      organizationId: $organizationId\n      range: $range\n      runPurposes: $runPurposes\n    ) {\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerUsers {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n      previousTotals {\n        ...CostTotalsFields\n      }\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n      users {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n    }\n  }\n": typeof types.OrganizationCostCardDocument,
    "\n  query AgentCostCard($agentId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {\n    agentCostCard(agentId: $agentId, range: $range, runPurposes: $runPurposes) {\n      agentId\n      agentName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerId\n      ownerName\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n      users {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n    }\n  }\n": typeof types.AgentCostCardDocument,
    "\n  query MemberCostCard($organizationId: ULID!, $memberId: ULID!, $range: CostRange!) {\n    memberCostCard(organizationId: $organizationId, memberId: $memberId, range: $range) {\n      owned {\n        ...CostAttributionFields\n      }\n      used {\n        ...CostAttributionFields\n      }\n    }\n  }\n": typeof types.MemberCostCardDocument,
    "\n  fragment EnvironmentPackageFields on EnvironmentPackageSpec {\n    manager\n    packages\n  }\n": typeof types.EnvironmentPackageFieldsFragmentDoc,
    "\n  fragment EnvironmentVariableFields on EnvironmentVariablePreview {\n    key\n    preview\n    status\n  }\n": typeof types.EnvironmentVariableFieldsFragmentDoc,
    "\n  fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n": typeof types.EnvironmentOwnerFieldsFragmentDoc,
    "\n  fragment EnvironmentSummaryFields on EnvironmentSummary {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    organizationId\n  }\n": typeof types.EnvironmentSummaryFieldsFragmentDoc,
    "\n  fragment EnvironmentShareTargetFields on EnvironmentShareTarget {\n    createdAt\n    email\n    id\n    kind\n    name\n  }\n": typeof types.EnvironmentShareTargetFieldsFragmentDoc,
    "\n  fragment EnvironmentDetailFields on EnvironmentDetail {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    shareTargets {\n      ...EnvironmentShareTargetFields\n    }\n    updatedAt\n    usedByAgentCount\n    organizationId\n  }\n": typeof types.EnvironmentDetailFieldsFragmentDoc,
    "\n  query OrganizationEnvironments($organizationId: ULID!) {\n    organizationEnvironmentList(organizationId: $organizationId) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": typeof types.OrganizationEnvironmentsDocument,
    "\n  query EnvironmentDetail($environmentId: ULID!) {\n    environment(environmentId: $environmentId) {\n      ...EnvironmentDetailFields\n    }\n  }\n": typeof types.EnvironmentDetailDocument,
    "\n  mutation CreateEnvironment($input: CreateEnvironmentInput!) {\n    createEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": typeof types.CreateEnvironmentDocument,
    "\n  mutation UpdateEnvironment($input: UpdateEnvironmentInput!) {\n    updateEnvironment(input: $input) {\n      ...EnvironmentDetailFields\n    }\n  }\n": typeof types.UpdateEnvironmentDocument,
    "\n  mutation CreateEnvironmentFork($input: CreateEnvironmentForkInput!) {\n    createEnvironmentFork(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": typeof types.CreateEnvironmentForkDocument,
    "\n  mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {\n    deleteEnvironment(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteEnvironmentDocument,
    "\n  mutation SetOrganizationDefaultEnvironment($input: SetOrganizationDefaultEnvironmentInput!) {\n    setOrganizationDefaultEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": typeof types.SetOrganizationDefaultEnvironmentDocument,
    "\n  mutation ShareEnvironmentWithUser($input: ShareEnvironmentWithUserInput!) {\n    shareEnvironmentWithUser(input: $input) {\n      ...EnvironmentShareTargetFields\n    }\n  }\n": typeof types.ShareEnvironmentWithUserDocument,
    "\n  mutation ShareEnvironmentWithOrganization($input: ShareEnvironmentWithOrganizationInput!) {\n    shareEnvironmentWithOrganization(input: $input) {\n      ...EnvironmentShareTargetFields\n    }\n  }\n": typeof types.ShareEnvironmentWithOrganizationDocument,
    "\n  mutation UnshareEnvironmentTarget($input: UnshareEnvironmentTargetInput!) {\n    unshareEnvironmentTarget(input: $input) {\n      ok\n    }\n  }\n": typeof types.UnshareEnvironmentTargetDocument,
    "\n  fragment McpCredentialFields on McpCredentialSummary {\n    authType\n    createdAt\n    expiresAt\n    id\n    scope\n    scopeValues\n    status\n    subjectLabel\n    updatedAt\n  }\n": typeof types.McpCredentialFieldsFragmentDoc,
    "\n  fragment McpServerFields on McpServerWithCredential {\n    authType\n    authorizationState\n    createdAt\n    credentialScope\n    credentialStatus\n    description\n    enabled\n    hasSharedCredential\n    iconUrl\n    id\n    name\n    ownerId\n    ownerName\n    source\n    updatedAt\n    url\n    organizationId\n    credential {\n      ...McpCredentialFields\n    }\n  }\n": typeof types.McpServerFieldsFragmentDoc,
    "\n  query McpRegistry($organizationId: ULID!) {\n    mcpRegistry(organizationId: $organizationId) {\n      currentUserEmail\n      currentUserId\n      currentUserName\n      isAdmin\n      personal {\n        ...McpServerFields\n      }\n      organizationId\n      organizationShared {\n        ...McpServerFields\n      }\n    }\n  }\n": typeof types.McpRegistryDocument,
    "\n  mutation CreatePersonalMcpServer($input: CreatePersonalMcpServerInput!) {\n    createPersonalMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": typeof types.CreatePersonalMcpServerDocument,
    "\n  mutation CreateOrganizationMcpServer($input: CreateOrganizationMcpServerInput!) {\n    createOrganizationMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": typeof types.CreateOrganizationMcpServerDocument,
    "\n  mutation ConnectMcpBearer($input: ConnectMcpBearerInput!) {\n    connectMcpBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": typeof types.ConnectMcpBearerDocument,
    "\n  mutation SetOrganizationSharedBearer($input: SetOrganizationSharedMcpBearerInput!) {\n    setOrganizationSharedBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": typeof types.SetOrganizationSharedBearerDocument,
    "\n  mutation ClearOrganizationSharedCredential($serverId: ULID!) {\n    clearOrganizationSharedCredential(serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n": typeof types.ClearOrganizationSharedCredentialDocument,
    "\n  mutation RevokeMcpUserCredential($serverId: ULID!) {\n    revokeMcpUserCredential(serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n": typeof types.RevokeMcpUserCredentialDocument,
    "\n  mutation SetMcpServerEnabled($serverId: ULID!, $enabled: Boolean!) {\n    setMcpServerEnabled(serverId: $serverId, enabled: $enabled) {\n      ...McpServerFields\n    }\n  }\n": typeof types.SetMcpServerEnabledDocument,
    "\n  mutation DeleteMcpServer($serverId: ULID!) {\n    deleteMcpServer(serverId: $serverId) {\n      ok\n    }\n  }\n": typeof types.DeleteMcpServerDocument,
    "\n  mutation StartMcpOAuth($input: StartMcpOAuthInput!) {\n    startMcpOAuth(input: $input) {\n      authorizationUrl\n      flowId\n    }\n  }\n": typeof types.StartMcpOAuthDocument,
    "\n  query McpOAuthFlowStatus($flowId: ULID!) {\n    mcpOAuthFlowStatus(flowId: $flowId) {\n      authorizationState\n      errorMessage\n      flowId\n      serverId\n      status\n      subjectLabel\n    }\n  }\n": typeof types.McpOAuthFlowStatusDocument,
    "\n  query OnboardingDiscovery {\n    onboardingDiscovery {\n      domain\n      isPublicEmail\n      orgs {\n        creator\n        id\n        joinPolicy\n        memberCount\n        name\n      }\n    }\n  }\n": typeof types.OnboardingDiscoveryDocument,
    "\n  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {\n    onboardingBootstrap(input: $input) {\n      completed\n      organization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n    }\n  }\n": typeof types.OnboardingBootstrapDocument,
    "\n  query OrganizationAccessRequests($organizationId: ULID!) {\n    organizationAccessRequestList(organizationId: $organizationId) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n": typeof types.OrganizationAccessRequestsDocument,
    "\n  query OrganizationJoinTarget($organizationId: ULID!) {\n    organizationJoinTarget(organizationId: $organizationId) {\n      organizationId\n      organizationName\n      viewerIsAuthenticated\n      viewerIsMember\n      pendingInvitation {\n        createdAt\n        email\n        expiresAt\n        id\n        invitedBy\n        invitedByName\n        organizationId\n        organizationName\n        status\n        updatedAt\n        accountId\n      }\n      pendingRequest {\n        createdAt\n        id\n        organizationId\n        organizationName\n        referrerAccountId\n        referrerName\n        requestedByAccountId\n        requesterEmail\n        requesterName\n        reviewedAt\n        reviewedBy\n        reviewedByName\n        status\n        updatedAt\n      }\n      organization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n    }\n  }\n": typeof types.OrganizationJoinTargetDocument,
    "\n  mutation RequestOrganizationAccess($input: RequestOrganizationAccessInput!) {\n    requestOrganizationAccess(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n": typeof types.RequestOrganizationAccessDocument,
    "\n  mutation RequestOrganizationInvitation($input: RequestOrganizationInvitationInput!) {\n    requestOrganizationInvitation(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n": typeof types.RequestOrganizationInvitationDocument,
    "\n  mutation ReviewOrganizationAccessRequest($input: ReviewOrganizationAccessRequestInput!) {\n    reviewOrganizationAccessRequest(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n": typeof types.ReviewOrganizationAccessRequestDocument,
    "\n  mutation UpdateOrganizationJoinPolicy($input: UpdateOrganizationJoinPolicyInput!) {\n    updateOrganizationJoinPolicy(input: $input) {\n      joinPolicy\n    }\n  }\n": typeof types.UpdateOrganizationJoinPolicyDocument,
    "\n  mutation CreateOrganization($input: CreateOrganizationInput!) {\n    createOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": typeof types.CreateOrganizationDocument,
    "\n  mutation SetActiveOrganization($input: SetActiveOrganizationInput!) {\n    setActiveOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": typeof types.SetActiveOrganizationDocument,
    "\n  mutation UpdateOrganizationPrimaryDomain($input: UpdateOrganizationPrimaryDomainInput!) {\n    updateOrganizationPrimaryDomain(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": typeof types.UpdateOrganizationPrimaryDomainDocument,
    "\n  mutation UpdateOrganizationProfile($input: UpdateOrganizationProfileInput!) {\n    updateOrganizationProfile(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": typeof types.UpdateOrganizationProfileDocument,
    "\n  query OrganizationInvitations($organizationId: ULID!) {\n    organizationInvitationList(organizationId: $organizationId) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n": typeof types.OrganizationInvitationsDocument,
    "\n  query PendingOrganizationInvitations {\n    pendingOrganizationInvitationList {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n": typeof types.PendingOrganizationInvitationsDocument,
    "\n  mutation InviteOrganizationMember($input: InviteOrganizationMemberInput!) {\n    inviteOrganizationMember(input: $input) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n": typeof types.InviteOrganizationMemberDocument,
    "\n  mutation AcceptOrganizationInvitation($input: AcceptOrganizationInvitationInput!) {\n    acceptOrganizationInvitation(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": typeof types.AcceptOrganizationInvitationDocument,
    "\n  mutation CancelOrganizationInvitation($input: CancelOrganizationInvitationInput!) {\n    cancelOrganizationInvitation(input: $input) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n": typeof types.CancelOrganizationInvitationDocument,
    "\n  query OrganizationMembers($organizationId: ULID!) {\n    organizationMemberList(organizationId: $organizationId) {\n      accountId\n      email\n      imageUrl\n      joinedAt\n      name\n      role\n      status\n      disabledAt\n      disabledByAccountId\n    }\n  }\n": typeof types.OrganizationMembersDocument,
    "\n  mutation UpdateOrganizationMemberRole($input: UpdateOrganizationMemberRoleInput!) {\n    updateOrganizationMemberRole(input: $input) {\n      accountId\n    }\n  }\n": typeof types.UpdateOrganizationMemberRoleDocument,
    "\n  mutation RemoveOrganizationMember($input: RemoveOrganizationMemberInput!) {\n    removeOrganizationMember(input: $input) {\n      ok\n    }\n  }\n": typeof types.RemoveOrganizationMemberDocument,
    "\n  query AgentRuntimeEvents(\n    $agentId: ULID!\n    $beforeCursor: String\n    $families: [AgentRuntimeEventFamily!]\n    $limit: Int!\n  ) {\n    agentRuntimeEvents(\n      agentId: $agentId\n      beforeCursor: $beforeCursor\n      families: $families\n      limit: $limit\n    ) {\n      nodes {\n        createdAt\n        cursor\n        eventType\n        family\n        id\n        occurredAt\n        sessionId\n        source\n        summary\n        visibility\n      }\n      pageInfo {\n        endCursor\n        hasMore\n        startCursor\n      }\n    }\n  }\n": typeof types.AgentRuntimeEventsDocument,
    "\n  query ThreadAgentSessionRetrieve($sessionId: ULID!) {\n    threadAgentSessionRetrieve(sessionId: $sessionId) {\n      capabilities {\n        action\n        reason\n        status\n      }\n      recoverability {\n        reason\n        status\n      }\n      session {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        organizationId\n        provider\n        runtimeId\n        status\n        title\n        updatedAt\n      }\n    }\n  }\n": typeof types.ThreadAgentSessionRetrieveDocument,
    "\n  query AgentSessionDiagnostics($sessionId: ULID!) {\n    agentSessionDiagnostics(sessionId: $sessionId) {\n      execution {\n        binding {\n          deploymentVersionId\n          deploymentVersionNumber\n          kind\n          model\n          provider\n          runtimeId\n          sessionId\n        }\n        skills {\n          skillId\n          skillName\n        }\n        spaces {\n          spaceId\n        }\n        tools {\n          credentialMode\n          serverId\n        }\n      }\n      generatedAt\n      nativeRuntimeRef {\n        kind\n        runtimeId\n        status\n        valuePreview\n      }\n      pendingPermissionCount\n      session {\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastRun {\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          model\n          provider\n          status\n          traceId\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n      }\n    }\n  }\n": typeof types.AgentSessionDiagnosticsDocument,
    "\n  mutation CreateAgentSession($input: CreateAgentSessionInput!) {\n    createAgentSession(input: $input) {\n      agentId\n      archivedAt\n      createdAt\n      deploymentVersionId\n      deploymentVersionNumber\n      id\n      kind\n      lastMessageAt\n      lastRun {\n        completedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        error {\n          code\n          details\n          message\n          retryable\n        }\n        id\n        model\n        provider\n        startedAt\n        status\n        traceId\n        trigger\n        updatedAt\n      }\n      model\n      provider\n      runtimeId\n      status\n      title\n      type\n      updatedAt\n      organizationId\n    }\n  }\n": typeof types.CreateAgentSessionDocument,
    "\n  query AgentSessionList(\n    $agentId: ULID!\n    $archived: Boolean\n    $participantOnly: Boolean\n    $type: SessionType\n  ) {\n    agentSessionList(\n      agentId: $agentId\n      archived: $archived\n      participantOnly: $participantOnly\n      type: $type\n    ) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n        organizationId\n      }\n    }\n  }\n": typeof types.AgentSessionListDocument,
    "\n  query AgentSessionProcessEvents($limit: Int!, $sessionId: ULID!) {\n    sessionProcessEvents(limit: $limit, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n": typeof types.AgentSessionProcessEventsDocument,
    "\n  query ThreadSessionMessages($sessionId: ULID!) {\n    threadSessionMessages(sessionId: $sessionId) {\n      content\n      createdAt\n      createdBy\n      id\n      plan {\n        content\n        priority\n        status\n      }\n      role\n      segments {\n        argsText\n        kind\n        output\n        path\n        text\n        tool\n        toolCallId\n      }\n    }\n  }\n": typeof types.ThreadSessionMessagesDocument,
    "\n  mutation SendAgentSessionEvents($sessionId: ULID!, $events: [AgentSessionEventInput!]!) {\n    sendAgentSessionEvents(sessionId: $sessionId, events: $events) {\n      acceptedAt\n      warnings {\n        code\n        message\n      }\n    }\n  }\n": typeof types.SendAgentSessionEventsDocument,
    "\n  mutation PrewarmAgentSession($sessionId: ULID!) {\n    prewarmAgentSession(sessionId: $sessionId) {\n      scheduledAt\n      sessionId\n    }\n  }\n": typeof types.PrewarmAgentSessionDocument,
    "\n  query Sessions($organizationId: ULID!, $archived: Boolean, $type: SessionType) {\n    sessionList(organizationId: $organizationId, archived: $archived, type: $type) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n        organizationId\n      }\n    }\n  }\n": typeof types.SessionsDocument,
    "\n  query ThreadAgentSessionList($organizationId: ULID!, $archived: Boolean, $type: SessionType) {\n    threadAgentSessionList(organizationId: $organizationId, archived: $archived, type: $type) {\n      nodes {\n        capabilities {\n          action\n          reason\n          status\n        }\n        session {\n          agentId\n          archivedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          kind\n          lastMessageAt\n          lastRun {\n            completedAt\n            createdAt\n            deploymentVersionId\n            deploymentVersionNumber\n            error {\n              code\n              details\n              message\n              retryable\n            }\n            id\n            model\n            provider\n            startedAt\n            status\n            traceId\n            trigger\n            updatedAt\n          }\n          model\n          provider\n          runtimeId\n          status\n          title\n          type\n          updatedAt\n          organizationId\n        }\n      }\n    }\n  }\n": typeof types.ThreadAgentSessionListDocument,
    "\n  mutation AutoTitleSession($input: RenameSessionInput!) {\n    autoTitleSession(input: $input) {\n      id\n    }\n  }\n": typeof types.AutoTitleSessionDocument,
    "\n  mutation ArchiveSession($sessionId: ULID!) {\n    archiveAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n": typeof types.ArchiveSessionDocument,
    "\n  mutation RestoreSession($sessionId: ULID!) {\n    unarchiveAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n": typeof types.RestoreSessionDocument,
    "\n  mutation DeleteAgentSession($sessionId: ULID!) {\n    deleteAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n": typeof types.DeleteAgentSessionDocument,
    "\n  mutation AddSessionResource($input: AddSessionResourceInput!) {\n    addSessionResource(input: $input) {\n      contentType\n      expectedSize\n      expiresAt\n      fileId\n      owner {\n        id\n        kind\n      }\n      partSize\n      path\n      purpose\n      scope {\n        id\n        kind\n      }\n      status\n      strategy\n    }\n  }\n": typeof types.AddSessionResourceDocument,
    "\n  query ListSessionResources($sessionId: ULID!) {\n    listSessionResources(sessionId: $sessionId) {\n      createdAt\n      id\n      mimeType\n      name\n      path\n      size\n    }\n  }\n": typeof types.ListSessionResourcesDocument,
    "\n  mutation RemoveSessionResource($input: RemoveSessionResourceInput!) {\n    removeSessionResource(input: $input) {\n      ok\n    }\n  }\n": typeof types.RemoveSessionResourceDocument,
    "\n  query SessionThreadUiStateList($organizationId: ULID!) {\n    sessionThreadUiStateList(organizationId: $organizationId) {\n      pinned\n      readAt\n      sessionId\n      updatedAt\n    }\n  }\n": typeof types.SessionThreadUiStateListDocument,
    "\n  mutation UpdateSessionThreadUiState($input: UpdateSessionThreadUiStateInput!) {\n    updateSessionThreadUiState(input: $input) {\n      pinned\n      readAt\n      sessionId\n      updatedAt\n    }\n  }\n": typeof types.UpdateSessionThreadUiStateDocument,
    "\n  query SessionProcessEvents($limit: Int!, $sessionId: ULID!) {\n    threadSessionProcessEvents(limit: $limit, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n": typeof types.SessionProcessEventsDocument,
    "\n  fragment SkillSummaryFields on SkillSummary {\n    author\n    autoEnabled\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    role\n    snapshotId\n    sourceKind\n    updatedAt\n    organizationId\n  }\n": typeof types.SkillSummaryFieldsFragmentDoc,
    "\n  fragment SkillShareTargetFields on SkillShareTarget {\n    createdAt\n    email\n    id\n    kind\n    name\n  }\n": typeof types.SkillShareTargetFieldsFragmentDoc,
    "\n  fragment SkillDetailFields on SkillDetail {\n    author\n    autoEnabled\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    role\n    snapshotId\n    sourceKind\n    updatedAt\n    organizationId\n    currentSnapshot {\n      archiveFormat\n      author\n      blobKey\n      blobSha256\n      blobSize\n      compression\n      createdAt\n      description\n      id\n      name\n      skillMarkdownPath\n      uncompressedSize\n      version\n    }\n    entries {\n      entryKind\n      isExecutable\n      mimeType\n      path\n      sha256\n      size\n    }\n    shareTargets {\n      ...SkillShareTargetFields\n    }\n  }\n": typeof types.SkillDetailFieldsFragmentDoc,
    "\n  query SkillDetail($skillId: ULID!) {\n    skillDetail(skillId: $skillId) {\n      ...SkillDetailFields\n    }\n  }\n": typeof types.SkillDetailDocument,
    "\n  query OrganizationSkills($organizationId: ULID!) {\n    organizationSkillList(organizationId: $organizationId) {\n      ...SkillSummaryFields\n    }\n  }\n": typeof types.OrganizationSkillsDocument,
    "\n  mutation CreateSkillFork($input: CreateSkillForkInput!) {\n    createSkillFork(input: $input) {\n      ...SkillSummaryFields\n    }\n  }\n": typeof types.CreateSkillForkDocument,
    "\n  mutation DeleteOwnedSkill($skillId: ULID!) {\n    deleteOwnedSkill(skillId: $skillId) {\n      ok\n    }\n  }\n": typeof types.DeleteOwnedSkillDocument,
    "\n  mutation ShareSkillWithUser($input: ShareSkillWithUserInput!) {\n    shareSkillWithUser(input: $input) {\n      ...SkillShareTargetFields\n    }\n  }\n": typeof types.ShareSkillWithUserDocument,
    "\n  mutation ShareSkillWithOrganization($input: ShareSkillWithOrganizationInput!) {\n    shareSkillWithOrganization(input: $input) {\n      ...SkillShareTargetFields\n    }\n  }\n": typeof types.ShareSkillWithOrganizationDocument,
    "\n  mutation UnshareSkillTarget($input: UnshareSkillTargetInput!) {\n    unshareSkillTarget(input: $input) {\n      ok\n    }\n  }\n": typeof types.UnshareSkillTargetDocument,
    "\n  query SpaceCollaborators($spaceId: ULID!) {\n    spaceCollaboratorList(spaceId: $spaceId) {\n      assignedBy\n      createdAt\n      email\n      imageUrl\n      name\n      principal\n      role\n    }\n  }\n": typeof types.SpaceCollaboratorsDocument,
    "\n  mutation AddCollaborator($input: AddCollaboratorInput!) {\n    addCollaborator(input: $input) {\n      principal\n    }\n  }\n": typeof types.AddCollaboratorDocument,
    "\n  mutation AddOrganizationCollaborator($input: AddOrganizationCollaboratorInput!) {\n    addOrganizationCollaborator(input: $input) {\n      principal\n    }\n  }\n": typeof types.AddOrganizationCollaboratorDocument,
    "\n  mutation UpdateCollaborator($input: UpdateCollaboratorInput!) {\n    updateCollaborator(input: $input) {\n      principal\n    }\n  }\n": typeof types.UpdateCollaboratorDocument,
    "\n  mutation RemoveCollaborator($input: RemoveCollaboratorInput!) {\n    removeCollaborator(input: $input) {\n      ok\n    }\n  }\n": typeof types.RemoveCollaboratorDocument,
    "\n  mutation CreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      createdAt\n      id\n      isSharedWithViewer\n      name\n      ownerId\n      role\n      storagePrefix\n      canDelete\n      canUpdateAcl\n      creatorMembershipStatus\n      viewerAssetRole\n      visibility\n    }\n  }\n": typeof types.CreateSpaceDocument,
    "\n  mutation DeleteSpace($spaceId: ULID!) {\n    deleteSpace(spaceId: $spaceId) {\n      ok\n    }\n  }\n": typeof types.DeleteSpaceDocument,
    "\n  query SpaceFiles($spaceId: ULID!, $path: String) {\n    spaceFiles(spaceId: $spaceId, path: $path) {\n      directories {\n        key\n      }\n      files {\n        etag\n        id\n        key\n        lock {\n          expiresAt\n          holder {\n            displayName\n            id\n            type\n          }\n          path\n        }\n        mimeType\n        size\n        uploadedAt\n        version\n      }\n    }\n  }\n": typeof types.SpaceFilesDocument,
    "\n  mutation CreateSpaceDirectory($input: CreateSpaceDirectoryInput!) {\n    createSpaceDirectory(input: $input) {\n      key\n    }\n  }\n": typeof types.CreateSpaceDirectoryDocument,
    "\n  mutation DeleteSpaceEntry($input: DeleteSpaceEntryInput!) {\n    deleteSpaceEntry(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteSpaceEntryDocument,
    "\n  query Spaces($organizationId: ULID!) {\n    spaceList(organizationId: $organizationId) {\n      createdAt\n      id\n      isSharedWithViewer\n      name\n      ownerId\n      role\n      storagePrefix\n      canDelete\n      canUpdateAcl\n      creatorMembershipStatus\n      viewerAssetRole\n      visibility\n    }\n  }\n": typeof types.SpacesDocument,
    "\n  query Viewer {\n    viewer {\n      account {\n        email\n        id\n        imageUrl\n        name\n        systemAgentModel {\n          modelId\n          vendor\n        }\n      }\n      activeOrganization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n      auth {\n        currentSecurityLevel\n        methods\n      }\n      memberships {\n        joinedAt\n        role\n        organization {\n          avatarUrl\n          createdAt\n          id\n          joinPolicy\n          name\n          primaryDomain\n          slug\n          viewerRole\n        }\n      }\n      organizationCreationSlot {\n        occupied\n        organizationId\n      }\n    }\n  }\n": typeof types.ViewerDocument,
    "\n  mutation UpdateProfile($input: UpdateAccountProfileInput!) {\n    updateProfile(input: $input) {\n      imageUrl\n      name\n    }\n  }\n": typeof types.UpdateProfileDocument,
    "\n  mutation SetSystemAgentModel($input: SetSystemAgentModelInput!) {\n    setSystemAgentModel(input: $input) {\n      id\n      systemAgentModel {\n        modelId\n        vendor\n      }\n    }\n  }\n": typeof types.SetSystemAgentModelDocument,
    "\n  query VendorCredentialList($organizationId: ULID!) {\n    vendorCredentialList(organizationId: $organizationId) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n": typeof types.VendorCredentialListDocument,
    "\n  mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {\n    createVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n": typeof types.CreateVendorCredentialDocument,
    "\n  mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {\n    updateVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n": typeof types.UpdateVendorCredentialDocument,
    "\n  mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {\n    deleteVendorCredential(input: $input) {\n      ok\n    }\n  }\n": typeof types.DeleteVendorCredentialDocument,
    "\n  query AvailableAgentModels(\n    $runtimeId: String!\n    $currentModelId: String\n    $currentVendorId: String\n  ) {\n    availableAgentModels(\n      runtimeId: $runtimeId\n      currentModelId: $currentModelId\n      currentVendorId: $currentVendorId\n    ) {\n      available\n      displayName\n      modelId\n      reason\n      source\n      statusDetail\n      statusLabel\n      vendorId\n      vendorLabel\n    }\n  }\n": typeof types.AvailableAgentModelsDocument,
    "\n  mutation TestVendorCredential($input: TestVendorCredentialInput!) {\n    testVendorCredential(input: $input) {\n      errorCode\n      latencyMs\n      ok\n    }\n  }\n": typeof types.TestVendorCredentialDocument,
};
const documents: Documents = {
    "\n  mutation EnsureAgentBuilderThread($agentId: ULID!) {\n    ensureAgentBuilderThread(agentId: $agentId) {\n      agentId\n      createdAt\n      creatorAccountId\n      id\n      lastTurnAt\n      organizationId\n      status\n      title\n      updatedAt\n    }\n  }\n": types.EnsureAgentBuilderThreadDocument,
    "\n  mutation ExecuteAgentBuilderControlPlaneAction(\n    $input: ExecuteAgentBuilderControlPlaneActionInput!\n  ) {\n    executeAgentBuilderControlPlaneAction(input: $input) {\n      createdEnvironment {\n        id\n        name\n      }\n      createdMcpServer {\n        authType\n        id\n        name\n        url\n      }\n      message\n      secureUi {\n        kind\n        mcpServerId\n      }\n      sessionId\n      status\n      toolId\n    }\n  }\n": types.ExecuteAgentBuilderControlPlaneActionDocument,
    "\n  query AgentBuilderMessages($agentId: ULID!, $beforeSeq: Int, $limit: Int) {\n    agentBuilderMessages(agentId: $agentId, beforeSeq: $beforeSeq, limit: $limit) {\n      cardsJson\n      contentText\n      createdAt\n      createdByAccountId\n      id\n      inputKind\n      plannerRunId\n      role\n      seq\n      threadId\n    }\n  }\n": types.AgentBuilderMessagesDocument,
    "\n  fragment AgentChannelBindingFields on AgentChannelBinding {\n    activityLastTriggeredAt\n    activitySessionCount7d\n    agentId\n    createdAt\n    displayMetadata\n    externalBotId\n    externalTenantId\n    id\n    lastErrorCode\n    provider\n    status\n    updatedAt\n  }\n": types.AgentChannelBindingFieldsFragmentDoc,
    "\n  query AgentChannelBindings($agentId: ULID!) {\n    agentChannelBindingList(agentId: $agentId) {\n      ...AgentChannelBindingFields\n    }\n  }\n": types.AgentChannelBindingsDocument,
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
    "\n  mutation AddAgentCollaborator($input: AddAgentCollaboratorInput!) {\n    addAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n": types.AddAgentCollaboratorDocument,
    "\n  mutation RemoveAgentCollaborator($input: RemoveAgentCollaboratorInput!) {\n    removeAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n": types.RemoveAgentCollaboratorDocument,
    "\n  mutation UpdateAgentCollaborator($input: UpdateAgentCollaboratorInput!) {\n    updateAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n": types.UpdateAgentCollaboratorDocument,
    "\n  fragment AgentFields on Agent {\n    createdAt\n    description\n    id\n    kind\n    liveVersion {\n      ...AgentDeploymentVersionFields\n    }\n    model\n    name\n    packageSharingEnabled\n    prompt\n    provider\n    runtimeId\n    skills {\n      ownerName\n      skillId\n      skillName\n      state\n    }\n    status\n    updatedAt\n    visibility\n    organizationId\n  }\n": types.AgentFieldsFragmentDoc,
    "\n  fragment AgentToolSummaryFields on AgentToolSummary {\n    enabled\n    iconUrl\n    name\n    serverId\n  }\n": types.AgentToolSummaryFieldsFragmentDoc,
    "\n  fragment AgentDeploymentVersionFields on AgentDeploymentVersion {\n    agentId\n    createdAt\n    createdByAccountId\n    environmentId\n    id\n    isLive\n    kind\n    model\n    provider\n    runtimeId\n    summary\n    versionNumber\n  }\n": types.AgentDeploymentVersionFieldsFragmentDoc,
    "\n  fragment AgentOwnerFields on AgentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n": types.AgentOwnerFieldsFragmentDoc,
    "\n  mutation CreateAgent($input: CreateAgentInput!) {\n    createAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n": types.CreateAgentDocument,
    "\n  mutation DeleteAgent($input: DeleteAgentInput!) {\n    deleteAgent(input: $input) {\n      ok\n    }\n  }\n": types.DeleteAgentDocument,
    "\n  query AccessibleAgents($organizationId: ULID!) {\n    accessibleAgentList(organizationId: $organizationId) {\n      createdAt\n      description\n      id\n      kind\n      name\n      owner {\n        ...AgentOwnerFields\n      }\n      runtimeId\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      viewerRole\n      visibility\n      organizationId\n    }\n  }\n": types.AccessibleAgentsDocument,
    "\n  query Agent($agentId: ULID!) {\n    agent(agentId: $agentId) {\n      createdAt\n      description\n      id\n      kind\n      liveVersion {\n        ...AgentDeploymentVersionFields\n      }\n      model\n      name\n      owner {\n        ...AgentOwnerFields\n      }\n      packageSharingEnabled\n      prompt\n      provider\n      runtimeId\n      skills {\n        ownerName\n        skillId\n        skillName\n        state\n      }\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      versions {\n        ...AgentDeploymentVersionFields\n      }\n      viewerRole\n      visibility\n      organizationId\n    }\n  }\n": types.AgentDocument,
    "\n  query AgentEditorState($agentId: ULID!) {\n    agentEditorState(agentId: $agentId) {\n      id\n      builder {\n        componentDecisions {\n          agentType\n          environment\n        }\n      }\n      environment {\n        boundSpaceIds\n        environmentId\n      }\n      packageResolution {\n        recordedAt\n        source\n        report {\n          issues {\n            actionLabel\n            code\n            message\n            required\n            severity\n            status\n            targetLabel\n            targetType\n          }\n          summary {\n            boundMcpServerCount\n            boundSkillCount\n            boundSpaceCount\n            copiedAssetCount\n            createdMcpServerCount\n            reusedMcpServerCount\n          }\n        }\n      }\n      collaborators {\n        principal\n        role\n        name\n        email\n        imageUrl\n      }\n      mcpBindings {\n        authType\n        authorizationState\n        createdAt\n        credentialMode\n        credentialScope\n        credentialStatus\n        credentialSubject\n        enabled\n        hasSharedCredential\n        iconUrl\n        id\n        name\n        serverId\n        source\n        updatedAt\n        url\n      }\n      readiness {\n        checkedAt\n        ready\n        issues {\n          code\n          message\n          severity\n        }\n      }\n    }\n  }\n": types.AgentEditorStateDocument,
    "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      ...AgentFields\n    }\n  }\n": types.UpdateAgentConfigDocument,
    "\n  fragment AgentFileSessionNodeFields on AgentFileSessionNode {\n    active\n    id\n    status\n    title\n    updatedAt\n  }\n": types.AgentFileSessionNodeFieldsFragmentDoc,
    "\n  fragment AgentFileSpaceMountFields on AgentFileSpaceMountNode {\n    path\n    spaceId\n    spaceName\n    url\n  }\n": types.AgentFileSpaceMountFieldsFragmentDoc,
    "\n  fragment AgentFileEntryFields on AgentFileEntry {\n    kind\n    mimeType\n    name\n    path\n    persistence\n    preview\n    session {\n      ...AgentFileSessionNodeFields\n    }\n    sizeBytes\n    space {\n      ...AgentFileSpaceMountFields\n    }\n  }\n": types.AgentFileEntryFieldsFragmentDoc,
    "\n  query AgentFileTree($agentId: ULID!, $path: String!) {\n    agentFileTree(agentId: $agentId, path: $path) {\n      agentId\n      entries {\n        ...AgentFileEntryFields\n      }\n      lastError\n      path\n      sandboxId\n      sandboxStatus\n      totalCount\n      truncated\n    }\n  }\n": types.AgentFileTreeDocument,
    "\n  query AgentFileContent($agentId: ULID!, $path: String!) {\n    agentFileContent(agentId: $agentId, path: $path) {\n      agentId\n      content\n      mimeType\n      name\n      path\n      preview\n      sandboxId\n      sizeBytes\n    }\n  }\n": types.AgentFileContentDocument,
    "\n  query AgentManifest($agentId: ULID!) {\n    agentManifest(agentId: $agentId) {\n      agentId\n      json\n      yaml\n    }\n  }\n": types.AgentManifestDocument,
    "\n  query ExportAgentPackage($agentId: ULID!) {\n    exportAgentPackage(agentId: $agentId) {\n      agentId\n      contentType\n      fileId\n      fileName\n      manifestYaml\n      size\n    }\n  }\n": types.ExportAgentPackageDocument,
    "\n  mutation UpdateAgentPackageSharing($input: UpdateAgentPackageSharingInput!) {\n    updateAgentPackageSharing(input: $input) {\n      ...AgentFields\n    }\n  }\n": types.UpdateAgentPackageSharingDocument,
    "\n  mutation ImportAgentPackage($input: ImportAgentPackageInput!) {\n    importAgentPackage(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          boundSpaceCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n": types.ImportAgentPackageDocument,
    "\n  mutation CreateAgentFork($input: CreateAgentForkInput!) {\n    createAgentFork(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          boundSpaceCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n": types.CreateAgentForkDocument,
    "\n  mutation PublishAgent($input: PublishAgentInput!) {\n    publishAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n": types.PublishAgentDocument,
    "\n  mutation UnpublishAgent($agentId: ULID!) {\n    unpublishAgent(agentId: $agentId) {\n      ...AgentFields\n    }\n  }\n": types.UnpublishAgentDocument,
    "\n  mutation RestartDriver($input: RuntimeStateOperationInput!) {\n    restartDriver(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": types.RestartDriverDocument,
    "\n  mutation RecreateSandbox($input: RuntimeStateOperationInput!) {\n    recreateSandbox(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": types.RecreateSandboxDocument,
    "\n  mutation ResetAgentState($input: RuntimeStateOperationInput!) {\n    resetAgentState(input: $input) {\n      affectedSessionCount\n      agentId\n      ok\n      operation\n    }\n  }\n": types.ResetAgentStateDocument,
    "\n  fragment CostTotalsFields on CostAggregate {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n": types.CostTotalsFieldsFragmentDoc,
    "\n  fragment CostDailyFields on CostDailyPoint {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    date\n    inputTokens\n    outputTokens\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n  }\n": types.CostDailyFieldsFragmentDoc,
    "\n  fragment CostAgentFields on CostAgentRow {\n    activeUsers\n    agentId\n    agentName\n    cacheCreationTokens\n    cacheReadTokens\n    debugCostUsd\n    evalCostUsd\n    inputTokens\n    outputTokens\n    ownerEmail\n    ownerId\n    ownerName\n    previousCostUsd\n    previewCostUsd\n    productionCostUsd\n    requestCount\n    scheduledCostUsd\n    totalCostUsd\n    unpricedRequestCount\n  }\n": types.CostAgentFieldsFragmentDoc,
    "\n  fragment CostModelFields on CostModelRow {\n    activeUsers\n    cacheCreationTokens\n    cacheReadTokens\n    cacheReadUsdPerMillion\n    cacheWriteUsdPerMillion\n    inputTokens\n    inputUsdPerMillion\n    model\n    outputTokens\n    outputUsdPerMillion\n    provider\n    requestCount\n    totalCostUsd\n    unpricedRequestCount\n    vendor\n  }\n": types.CostModelFieldsFragmentDoc,
    "\n  fragment CostRecentSessionFields on CostRecentSession {\n    actorEmail\n    actorName\n    actorUserId\n    cacheCreationTokens\n    cacheReadTokens\n    createdAt\n    inputTokens\n    model\n    outputTokens\n    provider\n    runPurpose\n    sessionId\n    sessionRunId\n    totalCostUsd\n  }\n": types.CostRecentSessionFieldsFragmentDoc,
    "\n  fragment CostAttributionFields on CostAttributionCard {\n    agents {\n      ...CostAgentFields\n    }\n    daily {\n      ...CostDailyFields\n    }\n    models {\n      ...CostModelFields\n    }\n    recentSessions {\n      ...CostRecentSessionFields\n    }\n    totals {\n      ...CostTotalsFields\n    }\n  }\n": types.CostAttributionFieldsFragmentDoc,
    "\n  query OrganizationCostCard(\n    $organizationId: ULID!\n    $range: CostRange!\n    $runPurposes: [CostRunPurpose!]\n  ) {\n    organizationCostCard(\n      organizationId: $organizationId\n      range: $range\n      runPurposes: $runPurposes\n    ) {\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerUsers {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n      previousTotals {\n        ...CostTotalsFields\n      }\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n      users {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n    }\n  }\n": types.OrganizationCostCardDocument,
    "\n  query AgentCostCard($agentId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {\n    agentCostCard(agentId: $agentId, range: $range, runPurposes: $runPurposes) {\n      agentId\n      agentName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerId\n      ownerName\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n      users {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n    }\n  }\n": types.AgentCostCardDocument,
    "\n  query MemberCostCard($organizationId: ULID!, $memberId: ULID!, $range: CostRange!) {\n    memberCostCard(organizationId: $organizationId, memberId: $memberId, range: $range) {\n      owned {\n        ...CostAttributionFields\n      }\n      used {\n        ...CostAttributionFields\n      }\n    }\n  }\n": types.MemberCostCardDocument,
    "\n  fragment EnvironmentPackageFields on EnvironmentPackageSpec {\n    manager\n    packages\n  }\n": types.EnvironmentPackageFieldsFragmentDoc,
    "\n  fragment EnvironmentVariableFields on EnvironmentVariablePreview {\n    key\n    preview\n    status\n  }\n": types.EnvironmentVariableFieldsFragmentDoc,
    "\n  fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {\n    id\n    imageUrl\n    name\n  }\n": types.EnvironmentOwnerFieldsFragmentDoc,
    "\n  fragment EnvironmentSummaryFields on EnvironmentSummary {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    organizationId\n  }\n": types.EnvironmentSummaryFieldsFragmentDoc,
    "\n  fragment EnvironmentShareTargetFields on EnvironmentShareTarget {\n    createdAt\n    email\n    id\n    kind\n    name\n  }\n": types.EnvironmentShareTargetFieldsFragmentDoc,
    "\n  fragment EnvironmentDetailFields on EnvironmentDetail {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    shareTargets {\n      ...EnvironmentShareTargetFields\n    }\n    updatedAt\n    usedByAgentCount\n    organizationId\n  }\n": types.EnvironmentDetailFieldsFragmentDoc,
    "\n  query OrganizationEnvironments($organizationId: ULID!) {\n    organizationEnvironmentList(organizationId: $organizationId) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": types.OrganizationEnvironmentsDocument,
    "\n  query EnvironmentDetail($environmentId: ULID!) {\n    environment(environmentId: $environmentId) {\n      ...EnvironmentDetailFields\n    }\n  }\n": types.EnvironmentDetailDocument,
    "\n  mutation CreateEnvironment($input: CreateEnvironmentInput!) {\n    createEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": types.CreateEnvironmentDocument,
    "\n  mutation UpdateEnvironment($input: UpdateEnvironmentInput!) {\n    updateEnvironment(input: $input) {\n      ...EnvironmentDetailFields\n    }\n  }\n": types.UpdateEnvironmentDocument,
    "\n  mutation CreateEnvironmentFork($input: CreateEnvironmentForkInput!) {\n    createEnvironmentFork(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": types.CreateEnvironmentForkDocument,
    "\n  mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {\n    deleteEnvironment(input: $input) {\n      ok\n    }\n  }\n": types.DeleteEnvironmentDocument,
    "\n  mutation SetOrganizationDefaultEnvironment($input: SetOrganizationDefaultEnvironmentInput!) {\n    setOrganizationDefaultEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n": types.SetOrganizationDefaultEnvironmentDocument,
    "\n  mutation ShareEnvironmentWithUser($input: ShareEnvironmentWithUserInput!) {\n    shareEnvironmentWithUser(input: $input) {\n      ...EnvironmentShareTargetFields\n    }\n  }\n": types.ShareEnvironmentWithUserDocument,
    "\n  mutation ShareEnvironmentWithOrganization($input: ShareEnvironmentWithOrganizationInput!) {\n    shareEnvironmentWithOrganization(input: $input) {\n      ...EnvironmentShareTargetFields\n    }\n  }\n": types.ShareEnvironmentWithOrganizationDocument,
    "\n  mutation UnshareEnvironmentTarget($input: UnshareEnvironmentTargetInput!) {\n    unshareEnvironmentTarget(input: $input) {\n      ok\n    }\n  }\n": types.UnshareEnvironmentTargetDocument,
    "\n  fragment McpCredentialFields on McpCredentialSummary {\n    authType\n    createdAt\n    expiresAt\n    id\n    scope\n    scopeValues\n    status\n    subjectLabel\n    updatedAt\n  }\n": types.McpCredentialFieldsFragmentDoc,
    "\n  fragment McpServerFields on McpServerWithCredential {\n    authType\n    authorizationState\n    createdAt\n    credentialScope\n    credentialStatus\n    description\n    enabled\n    hasSharedCredential\n    iconUrl\n    id\n    name\n    ownerId\n    ownerName\n    source\n    updatedAt\n    url\n    organizationId\n    credential {\n      ...McpCredentialFields\n    }\n  }\n": types.McpServerFieldsFragmentDoc,
    "\n  query McpRegistry($organizationId: ULID!) {\n    mcpRegistry(organizationId: $organizationId) {\n      currentUserEmail\n      currentUserId\n      currentUserName\n      isAdmin\n      personal {\n        ...McpServerFields\n      }\n      organizationId\n      organizationShared {\n        ...McpServerFields\n      }\n    }\n  }\n": types.McpRegistryDocument,
    "\n  mutation CreatePersonalMcpServer($input: CreatePersonalMcpServerInput!) {\n    createPersonalMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": types.CreatePersonalMcpServerDocument,
    "\n  mutation CreateOrganizationMcpServer($input: CreateOrganizationMcpServerInput!) {\n    createOrganizationMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": types.CreateOrganizationMcpServerDocument,
    "\n  mutation ConnectMcpBearer($input: ConnectMcpBearerInput!) {\n    connectMcpBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": types.ConnectMcpBearerDocument,
    "\n  mutation SetOrganizationSharedBearer($input: SetOrganizationSharedMcpBearerInput!) {\n    setOrganizationSharedBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n": types.SetOrganizationSharedBearerDocument,
    "\n  mutation ClearOrganizationSharedCredential($serverId: ULID!) {\n    clearOrganizationSharedCredential(serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n": types.ClearOrganizationSharedCredentialDocument,
    "\n  mutation RevokeMcpUserCredential($serverId: ULID!) {\n    revokeMcpUserCredential(serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n": types.RevokeMcpUserCredentialDocument,
    "\n  mutation SetMcpServerEnabled($serverId: ULID!, $enabled: Boolean!) {\n    setMcpServerEnabled(serverId: $serverId, enabled: $enabled) {\n      ...McpServerFields\n    }\n  }\n": types.SetMcpServerEnabledDocument,
    "\n  mutation DeleteMcpServer($serverId: ULID!) {\n    deleteMcpServer(serverId: $serverId) {\n      ok\n    }\n  }\n": types.DeleteMcpServerDocument,
    "\n  mutation StartMcpOAuth($input: StartMcpOAuthInput!) {\n    startMcpOAuth(input: $input) {\n      authorizationUrl\n      flowId\n    }\n  }\n": types.StartMcpOAuthDocument,
    "\n  query McpOAuthFlowStatus($flowId: ULID!) {\n    mcpOAuthFlowStatus(flowId: $flowId) {\n      authorizationState\n      errorMessage\n      flowId\n      serverId\n      status\n      subjectLabel\n    }\n  }\n": types.McpOAuthFlowStatusDocument,
    "\n  query OnboardingDiscovery {\n    onboardingDiscovery {\n      domain\n      isPublicEmail\n      orgs {\n        creator\n        id\n        joinPolicy\n        memberCount\n        name\n      }\n    }\n  }\n": types.OnboardingDiscoveryDocument,
    "\n  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {\n    onboardingBootstrap(input: $input) {\n      completed\n      organization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n    }\n  }\n": types.OnboardingBootstrapDocument,
    "\n  query OrganizationAccessRequests($organizationId: ULID!) {\n    organizationAccessRequestList(organizationId: $organizationId) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n": types.OrganizationAccessRequestsDocument,
    "\n  query OrganizationJoinTarget($organizationId: ULID!) {\n    organizationJoinTarget(organizationId: $organizationId) {\n      organizationId\n      organizationName\n      viewerIsAuthenticated\n      viewerIsMember\n      pendingInvitation {\n        createdAt\n        email\n        expiresAt\n        id\n        invitedBy\n        invitedByName\n        organizationId\n        organizationName\n        status\n        updatedAt\n        accountId\n      }\n      pendingRequest {\n        createdAt\n        id\n        organizationId\n        organizationName\n        referrerAccountId\n        referrerName\n        requestedByAccountId\n        requesterEmail\n        requesterName\n        reviewedAt\n        reviewedBy\n        reviewedByName\n        status\n        updatedAt\n      }\n      organization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n    }\n  }\n": types.OrganizationJoinTargetDocument,
    "\n  mutation RequestOrganizationAccess($input: RequestOrganizationAccessInput!) {\n    requestOrganizationAccess(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n": types.RequestOrganizationAccessDocument,
    "\n  mutation RequestOrganizationInvitation($input: RequestOrganizationInvitationInput!) {\n    requestOrganizationInvitation(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n": types.RequestOrganizationInvitationDocument,
    "\n  mutation ReviewOrganizationAccessRequest($input: ReviewOrganizationAccessRequestInput!) {\n    reviewOrganizationAccessRequest(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n": types.ReviewOrganizationAccessRequestDocument,
    "\n  mutation UpdateOrganizationJoinPolicy($input: UpdateOrganizationJoinPolicyInput!) {\n    updateOrganizationJoinPolicy(input: $input) {\n      joinPolicy\n    }\n  }\n": types.UpdateOrganizationJoinPolicyDocument,
    "\n  mutation CreateOrganization($input: CreateOrganizationInput!) {\n    createOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": types.CreateOrganizationDocument,
    "\n  mutation SetActiveOrganization($input: SetActiveOrganizationInput!) {\n    setActiveOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": types.SetActiveOrganizationDocument,
    "\n  mutation UpdateOrganizationPrimaryDomain($input: UpdateOrganizationPrimaryDomainInput!) {\n    updateOrganizationPrimaryDomain(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": types.UpdateOrganizationPrimaryDomainDocument,
    "\n  mutation UpdateOrganizationProfile($input: UpdateOrganizationProfileInput!) {\n    updateOrganizationProfile(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": types.UpdateOrganizationProfileDocument,
    "\n  query OrganizationInvitations($organizationId: ULID!) {\n    organizationInvitationList(organizationId: $organizationId) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n": types.OrganizationInvitationsDocument,
    "\n  query PendingOrganizationInvitations {\n    pendingOrganizationInvitationList {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n": types.PendingOrganizationInvitationsDocument,
    "\n  mutation InviteOrganizationMember($input: InviteOrganizationMemberInput!) {\n    inviteOrganizationMember(input: $input) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n": types.InviteOrganizationMemberDocument,
    "\n  mutation AcceptOrganizationInvitation($input: AcceptOrganizationInvitationInput!) {\n    acceptOrganizationInvitation(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n": types.AcceptOrganizationInvitationDocument,
    "\n  mutation CancelOrganizationInvitation($input: CancelOrganizationInvitationInput!) {\n    cancelOrganizationInvitation(input: $input) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n": types.CancelOrganizationInvitationDocument,
    "\n  query OrganizationMembers($organizationId: ULID!) {\n    organizationMemberList(organizationId: $organizationId) {\n      accountId\n      email\n      imageUrl\n      joinedAt\n      name\n      role\n      status\n      disabledAt\n      disabledByAccountId\n    }\n  }\n": types.OrganizationMembersDocument,
    "\n  mutation UpdateOrganizationMemberRole($input: UpdateOrganizationMemberRoleInput!) {\n    updateOrganizationMemberRole(input: $input) {\n      accountId\n    }\n  }\n": types.UpdateOrganizationMemberRoleDocument,
    "\n  mutation RemoveOrganizationMember($input: RemoveOrganizationMemberInput!) {\n    removeOrganizationMember(input: $input) {\n      ok\n    }\n  }\n": types.RemoveOrganizationMemberDocument,
    "\n  query AgentRuntimeEvents(\n    $agentId: ULID!\n    $beforeCursor: String\n    $families: [AgentRuntimeEventFamily!]\n    $limit: Int!\n  ) {\n    agentRuntimeEvents(\n      agentId: $agentId\n      beforeCursor: $beforeCursor\n      families: $families\n      limit: $limit\n    ) {\n      nodes {\n        createdAt\n        cursor\n        eventType\n        family\n        id\n        occurredAt\n        sessionId\n        source\n        summary\n        visibility\n      }\n      pageInfo {\n        endCursor\n        hasMore\n        startCursor\n      }\n    }\n  }\n": types.AgentRuntimeEventsDocument,
    "\n  query ThreadAgentSessionRetrieve($sessionId: ULID!) {\n    threadAgentSessionRetrieve(sessionId: $sessionId) {\n      capabilities {\n        action\n        reason\n        status\n      }\n      recoverability {\n        reason\n        status\n      }\n      session {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        organizationId\n        provider\n        runtimeId\n        status\n        title\n        updatedAt\n      }\n    }\n  }\n": types.ThreadAgentSessionRetrieveDocument,
    "\n  query AgentSessionDiagnostics($sessionId: ULID!) {\n    agentSessionDiagnostics(sessionId: $sessionId) {\n      execution {\n        binding {\n          deploymentVersionId\n          deploymentVersionNumber\n          kind\n          model\n          provider\n          runtimeId\n          sessionId\n        }\n        skills {\n          skillId\n          skillName\n        }\n        spaces {\n          spaceId\n        }\n        tools {\n          credentialMode\n          serverId\n        }\n      }\n      generatedAt\n      nativeRuntimeRef {\n        kind\n        runtimeId\n        status\n        valuePreview\n      }\n      pendingPermissionCount\n      session {\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastRun {\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          model\n          provider\n          status\n          traceId\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n      }\n    }\n  }\n": types.AgentSessionDiagnosticsDocument,
    "\n  mutation CreateAgentSession($input: CreateAgentSessionInput!) {\n    createAgentSession(input: $input) {\n      agentId\n      archivedAt\n      createdAt\n      deploymentVersionId\n      deploymentVersionNumber\n      id\n      kind\n      lastMessageAt\n      lastRun {\n        completedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        error {\n          code\n          details\n          message\n          retryable\n        }\n        id\n        model\n        provider\n        startedAt\n        status\n        traceId\n        trigger\n        updatedAt\n      }\n      model\n      provider\n      runtimeId\n      status\n      title\n      type\n      updatedAt\n      organizationId\n    }\n  }\n": types.CreateAgentSessionDocument,
    "\n  query AgentSessionList(\n    $agentId: ULID!\n    $archived: Boolean\n    $participantOnly: Boolean\n    $type: SessionType\n  ) {\n    agentSessionList(\n      agentId: $agentId\n      archived: $archived\n      participantOnly: $participantOnly\n      type: $type\n    ) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n        organizationId\n      }\n    }\n  }\n": types.AgentSessionListDocument,
    "\n  query AgentSessionProcessEvents($limit: Int!, $sessionId: ULID!) {\n    sessionProcessEvents(limit: $limit, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n": types.AgentSessionProcessEventsDocument,
    "\n  query ThreadSessionMessages($sessionId: ULID!) {\n    threadSessionMessages(sessionId: $sessionId) {\n      content\n      createdAt\n      createdBy\n      id\n      plan {\n        content\n        priority\n        status\n      }\n      role\n      segments {\n        argsText\n        kind\n        output\n        path\n        text\n        tool\n        toolCallId\n      }\n    }\n  }\n": types.ThreadSessionMessagesDocument,
    "\n  mutation SendAgentSessionEvents($sessionId: ULID!, $events: [AgentSessionEventInput!]!) {\n    sendAgentSessionEvents(sessionId: $sessionId, events: $events) {\n      acceptedAt\n      warnings {\n        code\n        message\n      }\n    }\n  }\n": types.SendAgentSessionEventsDocument,
    "\n  mutation PrewarmAgentSession($sessionId: ULID!) {\n    prewarmAgentSession(sessionId: $sessionId) {\n      scheduledAt\n      sessionId\n    }\n  }\n": types.PrewarmAgentSessionDocument,
    "\n  query Sessions($organizationId: ULID!, $archived: Boolean, $type: SessionType) {\n    sessionList(organizationId: $organizationId, archived: $archived, type: $type) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n        organizationId\n      }\n    }\n  }\n": types.SessionsDocument,
    "\n  query ThreadAgentSessionList($organizationId: ULID!, $archived: Boolean, $type: SessionType) {\n    threadAgentSessionList(organizationId: $organizationId, archived: $archived, type: $type) {\n      nodes {\n        capabilities {\n          action\n          reason\n          status\n        }\n        session {\n          agentId\n          archivedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          kind\n          lastMessageAt\n          lastRun {\n            completedAt\n            createdAt\n            deploymentVersionId\n            deploymentVersionNumber\n            error {\n              code\n              details\n              message\n              retryable\n            }\n            id\n            model\n            provider\n            startedAt\n            status\n            traceId\n            trigger\n            updatedAt\n          }\n          model\n          provider\n          runtimeId\n          status\n          title\n          type\n          updatedAt\n          organizationId\n        }\n      }\n    }\n  }\n": types.ThreadAgentSessionListDocument,
    "\n  mutation AutoTitleSession($input: RenameSessionInput!) {\n    autoTitleSession(input: $input) {\n      id\n    }\n  }\n": types.AutoTitleSessionDocument,
    "\n  mutation ArchiveSession($sessionId: ULID!) {\n    archiveAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n": types.ArchiveSessionDocument,
    "\n  mutation RestoreSession($sessionId: ULID!) {\n    unarchiveAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n": types.RestoreSessionDocument,
    "\n  mutation DeleteAgentSession($sessionId: ULID!) {\n    deleteAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n": types.DeleteAgentSessionDocument,
    "\n  mutation AddSessionResource($input: AddSessionResourceInput!) {\n    addSessionResource(input: $input) {\n      contentType\n      expectedSize\n      expiresAt\n      fileId\n      owner {\n        id\n        kind\n      }\n      partSize\n      path\n      purpose\n      scope {\n        id\n        kind\n      }\n      status\n      strategy\n    }\n  }\n": types.AddSessionResourceDocument,
    "\n  query ListSessionResources($sessionId: ULID!) {\n    listSessionResources(sessionId: $sessionId) {\n      createdAt\n      id\n      mimeType\n      name\n      path\n      size\n    }\n  }\n": types.ListSessionResourcesDocument,
    "\n  mutation RemoveSessionResource($input: RemoveSessionResourceInput!) {\n    removeSessionResource(input: $input) {\n      ok\n    }\n  }\n": types.RemoveSessionResourceDocument,
    "\n  query SessionThreadUiStateList($organizationId: ULID!) {\n    sessionThreadUiStateList(organizationId: $organizationId) {\n      pinned\n      readAt\n      sessionId\n      updatedAt\n    }\n  }\n": types.SessionThreadUiStateListDocument,
    "\n  mutation UpdateSessionThreadUiState($input: UpdateSessionThreadUiStateInput!) {\n    updateSessionThreadUiState(input: $input) {\n      pinned\n      readAt\n      sessionId\n      updatedAt\n    }\n  }\n": types.UpdateSessionThreadUiStateDocument,
    "\n  query SessionProcessEvents($limit: Int!, $sessionId: ULID!) {\n    threadSessionProcessEvents(limit: $limit, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n": types.SessionProcessEventsDocument,
    "\n  fragment SkillSummaryFields on SkillSummary {\n    author\n    autoEnabled\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    role\n    snapshotId\n    sourceKind\n    updatedAt\n    organizationId\n  }\n": types.SkillSummaryFieldsFragmentDoc,
    "\n  fragment SkillShareTargetFields on SkillShareTarget {\n    createdAt\n    email\n    id\n    kind\n    name\n  }\n": types.SkillShareTargetFieldsFragmentDoc,
    "\n  fragment SkillDetailFields on SkillDetail {\n    author\n    autoEnabled\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    role\n    snapshotId\n    sourceKind\n    updatedAt\n    organizationId\n    currentSnapshot {\n      archiveFormat\n      author\n      blobKey\n      blobSha256\n      blobSize\n      compression\n      createdAt\n      description\n      id\n      name\n      skillMarkdownPath\n      uncompressedSize\n      version\n    }\n    entries {\n      entryKind\n      isExecutable\n      mimeType\n      path\n      sha256\n      size\n    }\n    shareTargets {\n      ...SkillShareTargetFields\n    }\n  }\n": types.SkillDetailFieldsFragmentDoc,
    "\n  query SkillDetail($skillId: ULID!) {\n    skillDetail(skillId: $skillId) {\n      ...SkillDetailFields\n    }\n  }\n": types.SkillDetailDocument,
    "\n  query OrganizationSkills($organizationId: ULID!) {\n    organizationSkillList(organizationId: $organizationId) {\n      ...SkillSummaryFields\n    }\n  }\n": types.OrganizationSkillsDocument,
    "\n  mutation CreateSkillFork($input: CreateSkillForkInput!) {\n    createSkillFork(input: $input) {\n      ...SkillSummaryFields\n    }\n  }\n": types.CreateSkillForkDocument,
    "\n  mutation DeleteOwnedSkill($skillId: ULID!) {\n    deleteOwnedSkill(skillId: $skillId) {\n      ok\n    }\n  }\n": types.DeleteOwnedSkillDocument,
    "\n  mutation ShareSkillWithUser($input: ShareSkillWithUserInput!) {\n    shareSkillWithUser(input: $input) {\n      ...SkillShareTargetFields\n    }\n  }\n": types.ShareSkillWithUserDocument,
    "\n  mutation ShareSkillWithOrganization($input: ShareSkillWithOrganizationInput!) {\n    shareSkillWithOrganization(input: $input) {\n      ...SkillShareTargetFields\n    }\n  }\n": types.ShareSkillWithOrganizationDocument,
    "\n  mutation UnshareSkillTarget($input: UnshareSkillTargetInput!) {\n    unshareSkillTarget(input: $input) {\n      ok\n    }\n  }\n": types.UnshareSkillTargetDocument,
    "\n  query SpaceCollaborators($spaceId: ULID!) {\n    spaceCollaboratorList(spaceId: $spaceId) {\n      assignedBy\n      createdAt\n      email\n      imageUrl\n      name\n      principal\n      role\n    }\n  }\n": types.SpaceCollaboratorsDocument,
    "\n  mutation AddCollaborator($input: AddCollaboratorInput!) {\n    addCollaborator(input: $input) {\n      principal\n    }\n  }\n": types.AddCollaboratorDocument,
    "\n  mutation AddOrganizationCollaborator($input: AddOrganizationCollaboratorInput!) {\n    addOrganizationCollaborator(input: $input) {\n      principal\n    }\n  }\n": types.AddOrganizationCollaboratorDocument,
    "\n  mutation UpdateCollaborator($input: UpdateCollaboratorInput!) {\n    updateCollaborator(input: $input) {\n      principal\n    }\n  }\n": types.UpdateCollaboratorDocument,
    "\n  mutation RemoveCollaborator($input: RemoveCollaboratorInput!) {\n    removeCollaborator(input: $input) {\n      ok\n    }\n  }\n": types.RemoveCollaboratorDocument,
    "\n  mutation CreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      createdAt\n      id\n      isSharedWithViewer\n      name\n      ownerId\n      role\n      storagePrefix\n      canDelete\n      canUpdateAcl\n      creatorMembershipStatus\n      viewerAssetRole\n      visibility\n    }\n  }\n": types.CreateSpaceDocument,
    "\n  mutation DeleteSpace($spaceId: ULID!) {\n    deleteSpace(spaceId: $spaceId) {\n      ok\n    }\n  }\n": types.DeleteSpaceDocument,
    "\n  query SpaceFiles($spaceId: ULID!, $path: String) {\n    spaceFiles(spaceId: $spaceId, path: $path) {\n      directories {\n        key\n      }\n      files {\n        etag\n        id\n        key\n        lock {\n          expiresAt\n          holder {\n            displayName\n            id\n            type\n          }\n          path\n        }\n        mimeType\n        size\n        uploadedAt\n        version\n      }\n    }\n  }\n": types.SpaceFilesDocument,
    "\n  mutation CreateSpaceDirectory($input: CreateSpaceDirectoryInput!) {\n    createSpaceDirectory(input: $input) {\n      key\n    }\n  }\n": types.CreateSpaceDirectoryDocument,
    "\n  mutation DeleteSpaceEntry($input: DeleteSpaceEntryInput!) {\n    deleteSpaceEntry(input: $input) {\n      ok\n    }\n  }\n": types.DeleteSpaceEntryDocument,
    "\n  query Spaces($organizationId: ULID!) {\n    spaceList(organizationId: $organizationId) {\n      createdAt\n      id\n      isSharedWithViewer\n      name\n      ownerId\n      role\n      storagePrefix\n      canDelete\n      canUpdateAcl\n      creatorMembershipStatus\n      viewerAssetRole\n      visibility\n    }\n  }\n": types.SpacesDocument,
    "\n  query Viewer {\n    viewer {\n      account {\n        email\n        id\n        imageUrl\n        name\n        systemAgentModel {\n          modelId\n          vendor\n        }\n      }\n      activeOrganization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n      auth {\n        currentSecurityLevel\n        methods\n      }\n      memberships {\n        joinedAt\n        role\n        organization {\n          avatarUrl\n          createdAt\n          id\n          joinPolicy\n          name\n          primaryDomain\n          slug\n          viewerRole\n        }\n      }\n      organizationCreationSlot {\n        occupied\n        organizationId\n      }\n    }\n  }\n": types.ViewerDocument,
    "\n  mutation UpdateProfile($input: UpdateAccountProfileInput!) {\n    updateProfile(input: $input) {\n      imageUrl\n      name\n    }\n  }\n": types.UpdateProfileDocument,
    "\n  mutation SetSystemAgentModel($input: SetSystemAgentModelInput!) {\n    setSystemAgentModel(input: $input) {\n      id\n      systemAgentModel {\n        modelId\n        vendor\n      }\n    }\n  }\n": types.SetSystemAgentModelDocument,
    "\n  query VendorCredentialList($organizationId: ULID!) {\n    vendorCredentialList(organizationId: $organizationId) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n": types.VendorCredentialListDocument,
    "\n  mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {\n    createVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n": types.CreateVendorCredentialDocument,
    "\n  mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {\n    updateVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n": types.UpdateVendorCredentialDocument,
    "\n  mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {\n    deleteVendorCredential(input: $input) {\n      ok\n    }\n  }\n": types.DeleteVendorCredentialDocument,
    "\n  query AvailableAgentModels(\n    $runtimeId: String!\n    $currentModelId: String\n    $currentVendorId: String\n  ) {\n    availableAgentModels(\n      runtimeId: $runtimeId\n      currentModelId: $currentModelId\n      currentVendorId: $currentVendorId\n    ) {\n      available\n      displayName\n      modelId\n      reason\n      source\n      statusDetail\n      statusLabel\n      vendorId\n      vendorLabel\n    }\n  }\n": types.AvailableAgentModelsDocument,
    "\n  mutation TestVendorCredential($input: TestVendorCredentialInput!) {\n    testVendorCredential(input: $input) {\n      errorCode\n      latencyMs\n      ok\n    }\n  }\n": types.TestVendorCredentialDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation EnsureAgentBuilderThread($agentId: ULID!) {\n    ensureAgentBuilderThread(agentId: $agentId) {\n      agentId\n      createdAt\n      creatorAccountId\n      id\n      lastTurnAt\n      organizationId\n      status\n      title\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').EnsureAgentBuilderThreadDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ExecuteAgentBuilderControlPlaneAction(\n    $input: ExecuteAgentBuilderControlPlaneActionInput!\n  ) {\n    executeAgentBuilderControlPlaneAction(input: $input) {\n      createdEnvironment {\n        id\n        name\n      }\n      createdMcpServer {\n        authType\n        id\n        name\n        url\n      }\n      message\n      secureUi {\n        kind\n        mcpServerId\n      }\n      sessionId\n      status\n      toolId\n    }\n  }\n"): typeof import('./graphql').ExecuteAgentBuilderControlPlaneActionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentBuilderMessages($agentId: ULID!, $beforeSeq: Int, $limit: Int) {\n    agentBuilderMessages(agentId: $agentId, beforeSeq: $beforeSeq, limit: $limit) {\n      cardsJson\n      contentText\n      createdAt\n      createdByAccountId\n      id\n      inputKind\n      plannerRunId\n      role\n      seq\n      threadId\n    }\n  }\n"): typeof import('./graphql').AgentBuilderMessagesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentChannelBindingFields on AgentChannelBinding {\n    activityLastTriggeredAt\n    activitySessionCount7d\n    agentId\n    createdAt\n    displayMetadata\n    externalBotId\n    externalTenantId\n    id\n    lastErrorCode\n    provider\n    status\n    updatedAt\n  }\n"): typeof import('./graphql').AgentChannelBindingFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentChannelBindings($agentId: ULID!) {\n    agentChannelBindingList(agentId: $agentId) {\n      ...AgentChannelBindingFields\n    }\n  }\n"): typeof import('./graphql').AgentChannelBindingsDocument;
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
export function graphql(source: "\n  mutation AddAgentCollaborator($input: AddAgentCollaboratorInput!) {\n    addAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').AddAgentCollaboratorDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveAgentCollaborator($input: RemoveAgentCollaboratorInput!) {\n    removeAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').RemoveAgentCollaboratorDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateAgentCollaborator($input: UpdateAgentCollaboratorInput!) {\n    updateAgentCollaborator(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').UpdateAgentCollaboratorDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentFields on Agent {\n    createdAt\n    description\n    id\n    kind\n    liveVersion {\n      ...AgentDeploymentVersionFields\n    }\n    model\n    name\n    packageSharingEnabled\n    prompt\n    provider\n    runtimeId\n    skills {\n      ownerName\n      skillId\n      skillName\n      state\n    }\n    status\n    updatedAt\n    visibility\n    organizationId\n  }\n"): typeof import('./graphql').AgentFieldsFragmentDoc;
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
export function graphql(source: "\n  query AccessibleAgents($organizationId: ULID!) {\n    accessibleAgentList(organizationId: $organizationId) {\n      createdAt\n      description\n      id\n      kind\n      name\n      owner {\n        ...AgentOwnerFields\n      }\n      runtimeId\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      viewerRole\n      visibility\n      organizationId\n    }\n  }\n"): typeof import('./graphql').AccessibleAgentsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Agent($agentId: ULID!) {\n    agent(agentId: $agentId) {\n      createdAt\n      description\n      id\n      kind\n      liveVersion {\n        ...AgentDeploymentVersionFields\n      }\n      model\n      name\n      owner {\n        ...AgentOwnerFields\n      }\n      packageSharingEnabled\n      prompt\n      provider\n      runtimeId\n      skills {\n        ownerName\n        skillId\n        skillName\n        state\n      }\n      status\n      tools {\n        ...AgentToolSummaryFields\n      }\n      updatedAt\n      versions {\n        ...AgentDeploymentVersionFields\n      }\n      viewerRole\n      visibility\n      organizationId\n    }\n  }\n"): typeof import('./graphql').AgentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentEditorState($agentId: ULID!) {\n    agentEditorState(agentId: $agentId) {\n      id\n      builder {\n        componentDecisions {\n          agentType\n          environment\n        }\n      }\n      environment {\n        boundSpaceIds\n        environmentId\n      }\n      packageResolution {\n        recordedAt\n        source\n        report {\n          issues {\n            actionLabel\n            code\n            message\n            required\n            severity\n            status\n            targetLabel\n            targetType\n          }\n          summary {\n            boundMcpServerCount\n            boundSkillCount\n            boundSpaceCount\n            copiedAssetCount\n            createdMcpServerCount\n            reusedMcpServerCount\n          }\n        }\n      }\n      collaborators {\n        principal\n        role\n        name\n        email\n        imageUrl\n      }\n      mcpBindings {\n        authType\n        authorizationState\n        createdAt\n        credentialMode\n        credentialScope\n        credentialStatus\n        credentialSubject\n        enabled\n        hasSharedCredential\n        iconUrl\n        id\n        name\n        serverId\n        source\n        updatedAt\n        url\n      }\n      readiness {\n        checkedAt\n        ready\n        issues {\n          code\n          message\n          severity\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').AgentEditorStateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {\n    updateAgentConfig(input: $input) {\n      ...AgentFields\n    }\n  }\n"): typeof import('./graphql').UpdateAgentConfigDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentFileSessionNodeFields on AgentFileSessionNode {\n    active\n    id\n    status\n    title\n    updatedAt\n  }\n"): typeof import('./graphql').AgentFileSessionNodeFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentFileSpaceMountFields on AgentFileSpaceMountNode {\n    path\n    spaceId\n    spaceName\n    url\n  }\n"): typeof import('./graphql').AgentFileSpaceMountFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment AgentFileEntryFields on AgentFileEntry {\n    kind\n    mimeType\n    name\n    path\n    persistence\n    preview\n    session {\n      ...AgentFileSessionNodeFields\n    }\n    sizeBytes\n    space {\n      ...AgentFileSpaceMountFields\n    }\n  }\n"): typeof import('./graphql').AgentFileEntryFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentFileTree($agentId: ULID!, $path: String!) {\n    agentFileTree(agentId: $agentId, path: $path) {\n      agentId\n      entries {\n        ...AgentFileEntryFields\n      }\n      lastError\n      path\n      sandboxId\n      sandboxStatus\n      totalCount\n      truncated\n    }\n  }\n"): typeof import('./graphql').AgentFileTreeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentFileContent($agentId: ULID!, $path: String!) {\n    agentFileContent(agentId: $agentId, path: $path) {\n      agentId\n      content\n      mimeType\n      name\n      path\n      preview\n      sandboxId\n      sizeBytes\n    }\n  }\n"): typeof import('./graphql').AgentFileContentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentManifest($agentId: ULID!) {\n    agentManifest(agentId: $agentId) {\n      agentId\n      json\n      yaml\n    }\n  }\n"): typeof import('./graphql').AgentManifestDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ExportAgentPackage($agentId: ULID!) {\n    exportAgentPackage(agentId: $agentId) {\n      agentId\n      contentType\n      fileId\n      fileName\n      manifestYaml\n      size\n    }\n  }\n"): typeof import('./graphql').ExportAgentPackageDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateAgentPackageSharing($input: UpdateAgentPackageSharingInput!) {\n    updateAgentPackageSharing(input: $input) {\n      ...AgentFields\n    }\n  }\n"): typeof import('./graphql').UpdateAgentPackageSharingDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ImportAgentPackage($input: ImportAgentPackageInput!) {\n    importAgentPackage(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          boundSpaceCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').ImportAgentPackageDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateAgentFork($input: CreateAgentForkInput!) {\n    createAgentFork(input: $input) {\n      agent {\n        ...AgentFields\n      }\n      resolution {\n        issues {\n          actionLabel\n          code\n          message\n          required\n          severity\n          status\n          targetLabel\n          targetType\n        }\n        summary {\n          boundMcpServerCount\n          boundSkillCount\n          boundSpaceCount\n          copiedAssetCount\n          createdMcpServerCount\n          reusedMcpServerCount\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').CreateAgentForkDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PublishAgent($input: PublishAgentInput!) {\n    publishAgent(input: $input) {\n      ...AgentFields\n    }\n  }\n"): typeof import('./graphql').PublishAgentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnpublishAgent($agentId: ULID!) {\n    unpublishAgent(agentId: $agentId) {\n      ...AgentFields\n    }\n  }\n"): typeof import('./graphql').UnpublishAgentDocument;
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
export function graphql(source: "\n  fragment CostRecentSessionFields on CostRecentSession {\n    actorEmail\n    actorName\n    actorUserId\n    cacheCreationTokens\n    cacheReadTokens\n    createdAt\n    inputTokens\n    model\n    outputTokens\n    provider\n    runPurpose\n    sessionId\n    sessionRunId\n    totalCostUsd\n  }\n"): typeof import('./graphql').CostRecentSessionFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment CostAttributionFields on CostAttributionCard {\n    agents {\n      ...CostAgentFields\n    }\n    daily {\n      ...CostDailyFields\n    }\n    models {\n      ...CostModelFields\n    }\n    recentSessions {\n      ...CostRecentSessionFields\n    }\n    totals {\n      ...CostTotalsFields\n    }\n  }\n"): typeof import('./graphql').CostAttributionFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationCostCard(\n    $organizationId: ULID!\n    $range: CostRange!\n    $runPurposes: [CostRunPurpose!]\n  ) {\n    organizationCostCard(\n      organizationId: $organizationId\n      range: $range\n      runPurposes: $runPurposes\n    ) {\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerUsers {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n      previousTotals {\n        ...CostTotalsFields\n      }\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n      users {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n    }\n  }\n"): typeof import('./graphql').OrganizationCostCardDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentCostCard($agentId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {\n    agentCostCard(agentId: $agentId, range: $range, runPurposes: $runPurposes) {\n      agentId\n      agentName\n      agents {\n        ...CostAgentFields\n      }\n      daily {\n        ...CostDailyFields\n      }\n      models {\n        ...CostModelFields\n      }\n      ownerId\n      ownerName\n      recentSessions {\n        ...CostRecentSessionFields\n      }\n      totals {\n        ...CostTotalsFields\n      }\n      users {\n        activeUsers\n        agentCount\n        cacheCreationTokens\n        cacheReadTokens\n        inputTokens\n        outputTokens\n        previousCostUsd\n        requestCount\n        topAgentId\n        topAgentName\n        totalCostUsd\n        unpricedRequestCount\n        userEmail\n        userId\n        userName\n      }\n    }\n  }\n"): typeof import('./graphql').AgentCostCardDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MemberCostCard($organizationId: ULID!, $memberId: ULID!, $range: CostRange!) {\n    memberCostCard(organizationId: $organizationId, memberId: $memberId, range: $range) {\n      owned {\n        ...CostAttributionFields\n      }\n      used {\n        ...CostAttributionFields\n      }\n    }\n  }\n"): typeof import('./graphql').MemberCostCardDocument;
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
export function graphql(source: "\n  fragment EnvironmentSummaryFields on EnvironmentSummary {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    updatedAt\n    usedByAgentCount\n    organizationId\n  }\n"): typeof import('./graphql').EnvironmentSummaryFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment EnvironmentShareTargetFields on EnvironmentShareTarget {\n    createdAt\n    email\n    id\n    kind\n    name\n  }\n"): typeof import('./graphql').EnvironmentShareTargetFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment EnvironmentDetailFields on EnvironmentDetail {\n    allowMcpServers\n    allowPackageManagers\n    allowedHosts\n    canDelete\n    canEdit\n    createdAt\n    currentRevisionId\n    description\n    envVars {\n      ...EnvironmentVariableFields\n    }\n    forkOrigin {\n      environmentId\n      name\n      ownerName\n    }\n    id\n    isBuiltIn\n    isDefault\n    isEditable\n    name\n    networkPolicy\n    owner {\n      ...EnvironmentOwnerFields\n    }\n    packages {\n      ...EnvironmentPackageFields\n    }\n    role\n    setupScript\n    shareTargets {\n      ...EnvironmentShareTargetFields\n    }\n    updatedAt\n    usedByAgentCount\n    organizationId\n  }\n"): typeof import('./graphql').EnvironmentDetailFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationEnvironments($organizationId: ULID!) {\n    organizationEnvironmentList(organizationId: $organizationId) {\n      ...EnvironmentSummaryFields\n    }\n  }\n"): typeof import('./graphql').OrganizationEnvironmentsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query EnvironmentDetail($environmentId: ULID!) {\n    environment(environmentId: $environmentId) {\n      ...EnvironmentDetailFields\n    }\n  }\n"): typeof import('./graphql').EnvironmentDetailDocument;
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
export function graphql(source: "\n  mutation CreateEnvironmentFork($input: CreateEnvironmentForkInput!) {\n    createEnvironmentFork(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n"): typeof import('./graphql').CreateEnvironmentForkDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {\n    deleteEnvironment(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteEnvironmentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetOrganizationDefaultEnvironment($input: SetOrganizationDefaultEnvironmentInput!) {\n    setOrganizationDefaultEnvironment(input: $input) {\n      ...EnvironmentSummaryFields\n    }\n  }\n"): typeof import('./graphql').SetOrganizationDefaultEnvironmentDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ShareEnvironmentWithUser($input: ShareEnvironmentWithUserInput!) {\n    shareEnvironmentWithUser(input: $input) {\n      ...EnvironmentShareTargetFields\n    }\n  }\n"): typeof import('./graphql').ShareEnvironmentWithUserDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ShareEnvironmentWithOrganization($input: ShareEnvironmentWithOrganizationInput!) {\n    shareEnvironmentWithOrganization(input: $input) {\n      ...EnvironmentShareTargetFields\n    }\n  }\n"): typeof import('./graphql').ShareEnvironmentWithOrganizationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnshareEnvironmentTarget($input: UnshareEnvironmentTargetInput!) {\n    unshareEnvironmentTarget(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').UnshareEnvironmentTargetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment McpCredentialFields on McpCredentialSummary {\n    authType\n    createdAt\n    expiresAt\n    id\n    scope\n    scopeValues\n    status\n    subjectLabel\n    updatedAt\n  }\n"): typeof import('./graphql').McpCredentialFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment McpServerFields on McpServerWithCredential {\n    authType\n    authorizationState\n    createdAt\n    credentialScope\n    credentialStatus\n    description\n    enabled\n    hasSharedCredential\n    iconUrl\n    id\n    name\n    ownerId\n    ownerName\n    source\n    updatedAt\n    url\n    organizationId\n    credential {\n      ...McpCredentialFields\n    }\n  }\n"): typeof import('./graphql').McpServerFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query McpRegistry($organizationId: ULID!) {\n    mcpRegistry(organizationId: $organizationId) {\n      currentUserEmail\n      currentUserId\n      currentUserName\n      isAdmin\n      personal {\n        ...McpServerFields\n      }\n      organizationId\n      organizationShared {\n        ...McpServerFields\n      }\n    }\n  }\n"): typeof import('./graphql').McpRegistryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreatePersonalMcpServer($input: CreatePersonalMcpServerInput!) {\n    createPersonalMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').CreatePersonalMcpServerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateOrganizationMcpServer($input: CreateOrganizationMcpServerInput!) {\n    createOrganizationMcpServer(input: $input) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').CreateOrganizationMcpServerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ConnectMcpBearer($input: ConnectMcpBearerInput!) {\n    connectMcpBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').ConnectMcpBearerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetOrganizationSharedBearer($input: SetOrganizationSharedMcpBearerInput!) {\n    setOrganizationSharedBearer(input: $input) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').SetOrganizationSharedBearerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ClearOrganizationSharedCredential($serverId: ULID!) {\n    clearOrganizationSharedCredential(serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').ClearOrganizationSharedCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RevokeMcpUserCredential($serverId: ULID!) {\n    revokeMcpUserCredential(serverId: $serverId) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').RevokeMcpUserCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetMcpServerEnabled($serverId: ULID!, $enabled: Boolean!) {\n    setMcpServerEnabled(serverId: $serverId, enabled: $enabled) {\n      ...McpServerFields\n    }\n  }\n"): typeof import('./graphql').SetMcpServerEnabledDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteMcpServer($serverId: ULID!) {\n    deleteMcpServer(serverId: $serverId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteMcpServerDocument;
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
export function graphql(source: "\n  query OnboardingDiscovery {\n    onboardingDiscovery {\n      domain\n      isPublicEmail\n      orgs {\n        creator\n        id\n        joinPolicy\n        memberCount\n        name\n      }\n    }\n  }\n"): typeof import('./graphql').OnboardingDiscoveryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {\n    onboardingBootstrap(input: $input) {\n      completed\n      organization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n    }\n  }\n"): typeof import('./graphql').OnboardingBootstrapDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationAccessRequests($organizationId: ULID!) {\n    organizationAccessRequestList(organizationId: $organizationId) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').OrganizationAccessRequestsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationJoinTarget($organizationId: ULID!) {\n    organizationJoinTarget(organizationId: $organizationId) {\n      organizationId\n      organizationName\n      viewerIsAuthenticated\n      viewerIsMember\n      pendingInvitation {\n        createdAt\n        email\n        expiresAt\n        id\n        invitedBy\n        invitedByName\n        organizationId\n        organizationName\n        status\n        updatedAt\n        accountId\n      }\n      pendingRequest {\n        createdAt\n        id\n        organizationId\n        organizationName\n        referrerAccountId\n        referrerName\n        requestedByAccountId\n        requesterEmail\n        requesterName\n        reviewedAt\n        reviewedBy\n        reviewedByName\n        status\n        updatedAt\n      }\n      organization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n    }\n  }\n"): typeof import('./graphql').OrganizationJoinTargetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestOrganizationAccess($input: RequestOrganizationAccessInput!) {\n    requestOrganizationAccess(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').RequestOrganizationAccessDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestOrganizationInvitation($input: RequestOrganizationInvitationInput!) {\n    requestOrganizationInvitation(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').RequestOrganizationInvitationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ReviewOrganizationAccessRequest($input: ReviewOrganizationAccessRequestInput!) {\n    reviewOrganizationAccessRequest(input: $input) {\n      createdAt\n      id\n      organizationId\n      organizationName\n      referrerAccountId\n      referrerName\n      requestedByAccountId\n      requesterEmail\n      requesterName\n      reviewedAt\n      reviewedBy\n      reviewedByName\n      status\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').ReviewOrganizationAccessRequestDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateOrganizationJoinPolicy($input: UpdateOrganizationJoinPolicyInput!) {\n    updateOrganizationJoinPolicy(input: $input) {\n      joinPolicy\n    }\n  }\n"): typeof import('./graphql').UpdateOrganizationJoinPolicyDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateOrganization($input: CreateOrganizationInput!) {\n    createOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n"): typeof import('./graphql').CreateOrganizationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetActiveOrganization($input: SetActiveOrganizationInput!) {\n    setActiveOrganization(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n"): typeof import('./graphql').SetActiveOrganizationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateOrganizationPrimaryDomain($input: UpdateOrganizationPrimaryDomainInput!) {\n    updateOrganizationPrimaryDomain(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n"): typeof import('./graphql').UpdateOrganizationPrimaryDomainDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateOrganizationProfile($input: UpdateOrganizationProfileInput!) {\n    updateOrganizationProfile(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n"): typeof import('./graphql').UpdateOrganizationProfileDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationInvitations($organizationId: ULID!) {\n    organizationInvitationList(organizationId: $organizationId) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n"): typeof import('./graphql').OrganizationInvitationsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PendingOrganizationInvitations {\n    pendingOrganizationInvitationList {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n"): typeof import('./graphql').PendingOrganizationInvitationsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation InviteOrganizationMember($input: InviteOrganizationMemberInput!) {\n    inviteOrganizationMember(input: $input) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n"): typeof import('./graphql').InviteOrganizationMemberDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AcceptOrganizationInvitation($input: AcceptOrganizationInvitationInput!) {\n    acceptOrganizationInvitation(input: $input) {\n      avatarUrl\n      createdAt\n      id\n      joinPolicy\n      name\n      primaryDomain\n      slug\n      viewerRole\n    }\n  }\n"): typeof import('./graphql').AcceptOrganizationInvitationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CancelOrganizationInvitation($input: CancelOrganizationInvitationInput!) {\n    cancelOrganizationInvitation(input: $input) {\n      createdAt\n      email\n      expiresAt\n      id\n      invitedBy\n      invitedByName\n      organizationId\n      organizationName\n      status\n      updatedAt\n      accountId\n    }\n  }\n"): typeof import('./graphql').CancelOrganizationInvitationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationMembers($organizationId: ULID!) {\n    organizationMemberList(organizationId: $organizationId) {\n      accountId\n      email\n      imageUrl\n      joinedAt\n      name\n      role\n      status\n      disabledAt\n      disabledByAccountId\n    }\n  }\n"): typeof import('./graphql').OrganizationMembersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateOrganizationMemberRole($input: UpdateOrganizationMemberRoleInput!) {\n    updateOrganizationMemberRole(input: $input) {\n      accountId\n    }\n  }\n"): typeof import('./graphql').UpdateOrganizationMemberRoleDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveOrganizationMember($input: RemoveOrganizationMemberInput!) {\n    removeOrganizationMember(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').RemoveOrganizationMemberDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentRuntimeEvents(\n    $agentId: ULID!\n    $beforeCursor: String\n    $families: [AgentRuntimeEventFamily!]\n    $limit: Int!\n  ) {\n    agentRuntimeEvents(\n      agentId: $agentId\n      beforeCursor: $beforeCursor\n      families: $families\n      limit: $limit\n    ) {\n      nodes {\n        createdAt\n        cursor\n        eventType\n        family\n        id\n        occurredAt\n        sessionId\n        source\n        summary\n        visibility\n      }\n      pageInfo {\n        endCursor\n        hasMore\n        startCursor\n      }\n    }\n  }\n"): typeof import('./graphql').AgentRuntimeEventsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ThreadAgentSessionRetrieve($sessionId: ULID!) {\n    threadAgentSessionRetrieve(sessionId: $sessionId) {\n      capabilities {\n        action\n        reason\n        status\n      }\n      recoverability {\n        reason\n        status\n      }\n      session {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        organizationId\n        provider\n        runtimeId\n        status\n        title\n        updatedAt\n      }\n    }\n  }\n"): typeof import('./graphql').ThreadAgentSessionRetrieveDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentSessionDiagnostics($sessionId: ULID!) {\n    agentSessionDiagnostics(sessionId: $sessionId) {\n      execution {\n        binding {\n          deploymentVersionId\n          deploymentVersionNumber\n          kind\n          model\n          provider\n          runtimeId\n          sessionId\n        }\n        skills {\n          skillId\n          skillName\n        }\n        spaces {\n          spaceId\n        }\n        tools {\n          credentialMode\n          serverId\n        }\n      }\n      generatedAt\n      nativeRuntimeRef {\n        kind\n        runtimeId\n        status\n        valuePreview\n      }\n      pendingPermissionCount\n      session {\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastRun {\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          model\n          provider\n          status\n          traceId\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n      }\n    }\n  }\n"): typeof import('./graphql').AgentSessionDiagnosticsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateAgentSession($input: CreateAgentSessionInput!) {\n    createAgentSession(input: $input) {\n      agentId\n      archivedAt\n      createdAt\n      deploymentVersionId\n      deploymentVersionNumber\n      id\n      kind\n      lastMessageAt\n      lastRun {\n        completedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        error {\n          code\n          details\n          message\n          retryable\n        }\n        id\n        model\n        provider\n        startedAt\n        status\n        traceId\n        trigger\n        updatedAt\n      }\n      model\n      provider\n      runtimeId\n      status\n      title\n      type\n      updatedAt\n      organizationId\n    }\n  }\n"): typeof import('./graphql').CreateAgentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentSessionList(\n    $agentId: ULID!\n    $archived: Boolean\n    $participantOnly: Boolean\n    $type: SessionType\n  ) {\n    agentSessionList(\n      agentId: $agentId\n      archived: $archived\n      participantOnly: $participantOnly\n      type: $type\n    ) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n        organizationId\n      }\n    }\n  }\n"): typeof import('./graphql').AgentSessionListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AgentSessionProcessEvents($limit: Int!, $sessionId: ULID!) {\n    sessionProcessEvents(limit: $limit, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n"): typeof import('./graphql').AgentSessionProcessEventsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ThreadSessionMessages($sessionId: ULID!) {\n    threadSessionMessages(sessionId: $sessionId) {\n      content\n      createdAt\n      createdBy\n      id\n      plan {\n        content\n        priority\n        status\n      }\n      role\n      segments {\n        argsText\n        kind\n        output\n        path\n        text\n        tool\n        toolCallId\n      }\n    }\n  }\n"): typeof import('./graphql').ThreadSessionMessagesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SendAgentSessionEvents($sessionId: ULID!, $events: [AgentSessionEventInput!]!) {\n    sendAgentSessionEvents(sessionId: $sessionId, events: $events) {\n      acceptedAt\n      warnings {\n        code\n        message\n      }\n    }\n  }\n"): typeof import('./graphql').SendAgentSessionEventsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation PrewarmAgentSession($sessionId: ULID!) {\n    prewarmAgentSession(sessionId: $sessionId) {\n      scheduledAt\n      sessionId\n    }\n  }\n"): typeof import('./graphql').PrewarmAgentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Sessions($organizationId: ULID!, $archived: Boolean, $type: SessionType) {\n    sessionList(organizationId: $organizationId, archived: $archived, type: $type) {\n      nodes {\n        agentId\n        archivedAt\n        createdAt\n        deploymentVersionId\n        deploymentVersionNumber\n        id\n        kind\n        lastMessageAt\n        lastRun {\n          completedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          error {\n            code\n            details\n            message\n            retryable\n          }\n          id\n          model\n          provider\n          startedAt\n          status\n          traceId\n          trigger\n          updatedAt\n        }\n        model\n        provider\n        runtimeId\n        status\n        title\n        type\n        updatedAt\n        organizationId\n      }\n    }\n  }\n"): typeof import('./graphql').SessionsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ThreadAgentSessionList($organizationId: ULID!, $archived: Boolean, $type: SessionType) {\n    threadAgentSessionList(organizationId: $organizationId, archived: $archived, type: $type) {\n      nodes {\n        capabilities {\n          action\n          reason\n          status\n        }\n        session {\n          agentId\n          archivedAt\n          createdAt\n          deploymentVersionId\n          deploymentVersionNumber\n          id\n          kind\n          lastMessageAt\n          lastRun {\n            completedAt\n            createdAt\n            deploymentVersionId\n            deploymentVersionNumber\n            error {\n              code\n              details\n              message\n              retryable\n            }\n            id\n            model\n            provider\n            startedAt\n            status\n            traceId\n            trigger\n            updatedAt\n          }\n          model\n          provider\n          runtimeId\n          status\n          title\n          type\n          updatedAt\n          organizationId\n        }\n      }\n    }\n  }\n"): typeof import('./graphql').ThreadAgentSessionListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AutoTitleSession($input: RenameSessionInput!) {\n    autoTitleSession(input: $input) {\n      id\n    }\n  }\n"): typeof import('./graphql').AutoTitleSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ArchiveSession($sessionId: ULID!) {\n    archiveAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').ArchiveSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RestoreSession($sessionId: ULID!) {\n    unarchiveAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').RestoreSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteAgentSession($sessionId: ULID!) {\n    deleteAgentSession(sessionId: $sessionId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteAgentSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddSessionResource($input: AddSessionResourceInput!) {\n    addSessionResource(input: $input) {\n      contentType\n      expectedSize\n      expiresAt\n      fileId\n      owner {\n        id\n        kind\n      }\n      partSize\n      path\n      purpose\n      scope {\n        id\n        kind\n      }\n      status\n      strategy\n    }\n  }\n"): typeof import('./graphql').AddSessionResourceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query ListSessionResources($sessionId: ULID!) {\n    listSessionResources(sessionId: $sessionId) {\n      createdAt\n      id\n      mimeType\n      name\n      path\n      size\n    }\n  }\n"): typeof import('./graphql').ListSessionResourcesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveSessionResource($input: RemoveSessionResourceInput!) {\n    removeSessionResource(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').RemoveSessionResourceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionThreadUiStateList($organizationId: ULID!) {\n    sessionThreadUiStateList(organizationId: $organizationId) {\n      pinned\n      readAt\n      sessionId\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').SessionThreadUiStateListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateSessionThreadUiState($input: UpdateSessionThreadUiStateInput!) {\n    updateSessionThreadUiState(input: $input) {\n      pinned\n      readAt\n      sessionId\n      updatedAt\n    }\n  }\n"): typeof import('./graphql').UpdateSessionThreadUiStateDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SessionProcessEvents($limit: Int!, $sessionId: ULID!) {\n    threadSessionProcessEvents(limit: $limit, sessionId: $sessionId) {\n      content\n      durationMs\n      id\n      occurredAt\n      status\n      tokens\n      type\n    }\n  }\n"): typeof import('./graphql').SessionProcessEventsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SkillSummaryFields on SkillSummary {\n    author\n    autoEnabled\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    role\n    snapshotId\n    sourceKind\n    updatedAt\n    organizationId\n  }\n"): typeof import('./graphql').SkillSummaryFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SkillShareTargetFields on SkillShareTarget {\n    createdAt\n    email\n    id\n    kind\n    name\n  }\n"): typeof import('./graphql').SkillShareTargetFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment SkillDetailFields on SkillDetail {\n    author\n    autoEnabled\n    createdAt\n    description\n    forkOrigin {\n      name\n      ownerName\n      skillId\n    }\n    id\n    name\n    ownerId\n    ownerName\n    role\n    snapshotId\n    sourceKind\n    updatedAt\n    organizationId\n    currentSnapshot {\n      archiveFormat\n      author\n      blobKey\n      blobSha256\n      blobSize\n      compression\n      createdAt\n      description\n      id\n      name\n      skillMarkdownPath\n      uncompressedSize\n      version\n    }\n    entries {\n      entryKind\n      isExecutable\n      mimeType\n      path\n      sha256\n      size\n    }\n    shareTargets {\n      ...SkillShareTargetFields\n    }\n  }\n"): typeof import('./graphql').SkillDetailFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SkillDetail($skillId: ULID!) {\n    skillDetail(skillId: $skillId) {\n      ...SkillDetailFields\n    }\n  }\n"): typeof import('./graphql').SkillDetailDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query OrganizationSkills($organizationId: ULID!) {\n    organizationSkillList(organizationId: $organizationId) {\n      ...SkillSummaryFields\n    }\n  }\n"): typeof import('./graphql').OrganizationSkillsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateSkillFork($input: CreateSkillForkInput!) {\n    createSkillFork(input: $input) {\n      ...SkillSummaryFields\n    }\n  }\n"): typeof import('./graphql').CreateSkillForkDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteOwnedSkill($skillId: ULID!) {\n    deleteOwnedSkill(skillId: $skillId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteOwnedSkillDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ShareSkillWithUser($input: ShareSkillWithUserInput!) {\n    shareSkillWithUser(input: $input) {\n      ...SkillShareTargetFields\n    }\n  }\n"): typeof import('./graphql').ShareSkillWithUserDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ShareSkillWithOrganization($input: ShareSkillWithOrganizationInput!) {\n    shareSkillWithOrganization(input: $input) {\n      ...SkillShareTargetFields\n    }\n  }\n"): typeof import('./graphql').ShareSkillWithOrganizationDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnshareSkillTarget($input: UnshareSkillTargetInput!) {\n    unshareSkillTarget(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').UnshareSkillTargetDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SpaceCollaborators($spaceId: ULID!) {\n    spaceCollaboratorList(spaceId: $spaceId) {\n      assignedBy\n      createdAt\n      email\n      imageUrl\n      name\n      principal\n      role\n    }\n  }\n"): typeof import('./graphql').SpaceCollaboratorsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddCollaborator($input: AddCollaboratorInput!) {\n    addCollaborator(input: $input) {\n      principal\n    }\n  }\n"): typeof import('./graphql').AddCollaboratorDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AddOrganizationCollaborator($input: AddOrganizationCollaboratorInput!) {\n    addOrganizationCollaborator(input: $input) {\n      principal\n    }\n  }\n"): typeof import('./graphql').AddOrganizationCollaboratorDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateCollaborator($input: UpdateCollaboratorInput!) {\n    updateCollaborator(input: $input) {\n      principal\n    }\n  }\n"): typeof import('./graphql').UpdateCollaboratorDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RemoveCollaborator($input: RemoveCollaboratorInput!) {\n    removeCollaborator(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').RemoveCollaboratorDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateSpace($input: CreateSpaceInput!) {\n    createSpace(input: $input) {\n      createdAt\n      id\n      isSharedWithViewer\n      name\n      ownerId\n      role\n      storagePrefix\n      canDelete\n      canUpdateAcl\n      creatorMembershipStatus\n      viewerAssetRole\n      visibility\n    }\n  }\n"): typeof import('./graphql').CreateSpaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSpace($spaceId: ULID!) {\n    deleteSpace(spaceId: $spaceId) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteSpaceDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SpaceFiles($spaceId: ULID!, $path: String) {\n    spaceFiles(spaceId: $spaceId, path: $path) {\n      directories {\n        key\n      }\n      files {\n        etag\n        id\n        key\n        lock {\n          expiresAt\n          holder {\n            displayName\n            id\n            type\n          }\n          path\n        }\n        mimeType\n        size\n        uploadedAt\n        version\n      }\n    }\n  }\n"): typeof import('./graphql').SpaceFilesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateSpaceDirectory($input: CreateSpaceDirectoryInput!) {\n    createSpaceDirectory(input: $input) {\n      key\n    }\n  }\n"): typeof import('./graphql').CreateSpaceDirectoryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSpaceEntry($input: DeleteSpaceEntryInput!) {\n    deleteSpaceEntry(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteSpaceEntryDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Spaces($organizationId: ULID!) {\n    spaceList(organizationId: $organizationId) {\n      createdAt\n      id\n      isSharedWithViewer\n      name\n      ownerId\n      role\n      storagePrefix\n      canDelete\n      canUpdateAcl\n      creatorMembershipStatus\n      viewerAssetRole\n      visibility\n    }\n  }\n"): typeof import('./graphql').SpacesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Viewer {\n    viewer {\n      account {\n        email\n        id\n        imageUrl\n        name\n        systemAgentModel {\n          modelId\n          vendor\n        }\n      }\n      activeOrganization {\n        avatarUrl\n        createdAt\n        id\n        joinPolicy\n        name\n        primaryDomain\n        slug\n        viewerRole\n      }\n      auth {\n        currentSecurityLevel\n        methods\n      }\n      memberships {\n        joinedAt\n        role\n        organization {\n          avatarUrl\n          createdAt\n          id\n          joinPolicy\n          name\n          primaryDomain\n          slug\n          viewerRole\n        }\n      }\n      organizationCreationSlot {\n        occupied\n        organizationId\n      }\n    }\n  }\n"): typeof import('./graphql').ViewerDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateProfile($input: UpdateAccountProfileInput!) {\n    updateProfile(input: $input) {\n      imageUrl\n      name\n    }\n  }\n"): typeof import('./graphql').UpdateProfileDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetSystemAgentModel($input: SetSystemAgentModelInput!) {\n    setSystemAgentModel(input: $input) {\n      id\n      systemAgentModel {\n        modelId\n        vendor\n      }\n    }\n  }\n"): typeof import('./graphql').SetSystemAgentModelDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query VendorCredentialList($organizationId: ULID!) {\n    vendorCredentialList(organizationId: $organizationId) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n"): typeof import('./graphql').VendorCredentialListDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {\n    createVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n"): typeof import('./graphql').CreateVendorCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {\n    updateVendorCredential(input: $input) {\n      apiBase\n      id\n      isDefault\n      isPreferred\n      maskedApiKey\n      models\n      name\n      ownerUserId\n      scope\n      vendorId\n      organizationId\n    }\n  }\n"): typeof import('./graphql').UpdateVendorCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {\n    deleteVendorCredential(input: $input) {\n      ok\n    }\n  }\n"): typeof import('./graphql').DeleteVendorCredentialDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query AvailableAgentModels(\n    $runtimeId: String!\n    $currentModelId: String\n    $currentVendorId: String\n  ) {\n    availableAgentModels(\n      runtimeId: $runtimeId\n      currentModelId: $currentModelId\n      currentVendorId: $currentVendorId\n    ) {\n      available\n      displayName\n      modelId\n      reason\n      source\n      statusDetail\n      statusLabel\n      vendorId\n      vendorLabel\n    }\n  }\n"): typeof import('./graphql').AvailableAgentModelsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation TestVendorCredential($input: TestVendorCredentialInput!) {\n    testVendorCredential(input: $input) {\n      errorCode\n      latencyMs\n      ok\n    }\n  }\n"): typeof import('./graphql').TestVendorCredentialDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
