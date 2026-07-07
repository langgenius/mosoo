import type {
  AppDeployment,
  AppDeploymentRun,
  AppDeploymentRunStatus,
  AppDeploymentTargetKind,
  AppOverviewBoundAgent,
  AppOverviewBoundAgentExposure,
  DeleteAppDeploymentInput,
  DeployAppInput,
} from "@mosoo/contracts/app";
import type { AppId } from "@mosoo/contracts/id";
import { parseNativeDeploymentRunResult } from "@mosoo/contracts/native-deployment-run";
import type { NativeDeploymentRunResult } from "@mosoo/contracts/native-deployment-run";
import type { PlatformId } from "@mosoo/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAgentId, toAppDeploymentId, toAppDeploymentRunId, toAppId } from "@/routes/typed-id";

/**
 * Strongly typed GraphQL access for the Deploy console (App overview +
 * deployment lifecycle). Mirrors {@link file://./app-client.ts}: `graphql()`
 * tagged documents drive `requestGraphQL`, and the raw payloads are mapped back
 * onto the shared `@mosoo/contracts/app` domain types.
 */

const NATIVE_RUN_RESULT_FRAGMENT = graphql(/* GraphQL */ `
  fragment AppDeploymentRunNativeFields on AppDeploymentRunNative {
    facts {
      agentCount
      agents {
        action
        exposed
        name
        versionNumber
      }
      specVersion
      web {
        agent
        declared
      }
    }
    validate {
      facts {
        agentCount
        agents {
          exposed
          name
          source
        }
        spec
        web {
          agent
          declared
        }
      }
      failures {
        action
        code
        field
        file
        problem
        severity
      }
      schemaVersion
      valid
    }
  }
`);

void NATIVE_RUN_RESULT_FRAGMENT;

const APP_DEPLOYMENT_OVERVIEW_QUERY = graphql(/* GraphQL */ `
  query AppDeploymentOverview($appId: ULID!) {
    appOverview(appId: $appId) {
      app {
        id
        name
      }
      boundAgents {
        agentId
        envVar
        expose
        name
      }
      deployment {
        appId
        createdAt
        defaultBranch
        id
        liveUrl
        plannedUrl
        repoName
        repoOwner
        repoUrl
        updatedAt
        latestRun {
          appId
          createdAt
          deploymentId
          errorCode
          errorMessage
          id
          liveUrl
          native {
            ...AppDeploymentRunNativeFields
          }
          plannedUrl
          sourceBranch
          sourceCommitSha
          status
          targetKind
          updatedAt
        }
      }
    }
  }
`);

const APP_DEPLOYMENT_RUN_LIST_QUERY = graphql(/* GraphQL */ `
  query AppDeploymentRunList($appId: ULID!, $limit: Int) {
    appDeploymentRunList(appId: $appId, limit: $limit) {
      appId
      createdAt
      deploymentId
      errorCode
      errorMessage
      id
      liveUrl
      native {
        ...AppDeploymentRunNativeFields
      }
      plannedUrl
      sourceBranch
      sourceCommitSha
      status
      targetKind
      updatedAt
    }
  }
`);

const DEPLOY_APP_MUTATION = graphql(/* GraphQL */ `
  mutation DeployApp($input: DeployAppInput!) {
    deployApp(input: $input) {
      appId
      createdAt
      deploymentId
      errorCode
      errorMessage
      id
      liveUrl
      native {
        ...AppDeploymentRunNativeFields
      }
      plannedUrl
      sourceBranch
      sourceCommitSha
      status
      targetKind
      updatedAt
    }
  }
`);

const DELETE_APP_DEPLOYMENT_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteAppDeployment($input: DeleteAppDeploymentInput!) {
    deleteAppDeployment(input: $input) {
      ok
    }
  }
`);

/**
 * Focused view of `appOverview` consumed by the Deploy console — the App's
 * display name plus its deployment and self-authorizing agent bindings.
 */
export interface AppDeploymentOverview {
  appName: string;
  boundAgents: AppOverviewBoundAgent[];
  deployment: AppDeployment | null;
}

interface RawNativeWebFact {
  agent: string | null;
  declared: boolean;
}

interface RawNativeAgentFact {
  action: string;
  exposed: boolean;
  name: string;
  versionNumber: number | null;
}

interface RawNativeFacts {
  agentCount: number;
  agents: RawNativeAgentFact[];
  specVersion: string;
  web: RawNativeWebFact;
}

interface RawNativeValidateFailure {
  action: string;
  code: string;
  field: string | null;
  file: string;
  problem: string;
  severity: string;
}

interface RawNativeValidateAgentFact {
  exposed: boolean;
  name: string;
  source: string;
}

interface RawNativeValidateFacts {
  agentCount: number;
  agents: RawNativeValidateAgentFact[];
  spec: string;
  web: RawNativeWebFact;
}

interface RawNativeValidate {
  facts: RawNativeValidateFacts | null;
  failures: RawNativeValidateFailure[];
  schemaVersion: number;
  valid: boolean;
}

interface RawNativeRunResult {
  facts: RawNativeFacts | null;
  validate: RawNativeValidate;
}

interface RawDeploymentRun {
  appId: PlatformId;
  createdAt: string;
  deploymentId: PlatformId;
  errorCode: string | null;
  errorMessage: string | null;
  id: PlatformId;
  liveUrl: string | null;
  native: RawNativeRunResult | null;
  plannedUrl: string;
  sourceBranch: string;
  sourceCommitSha: string;
  status: AppDeploymentRunStatus;
  targetKind: AppDeploymentTargetKind | null;
  updatedAt: string;
}

interface RawDeployment {
  appId: PlatformId;
  createdAt: string;
  defaultBranch: string;
  id: PlatformId;
  latestRun: RawDeploymentRun | null;
  liveUrl: string | null;
  plannedUrl: string;
  repoName: string;
  repoOwner: string;
  repoUrl: string;
  updatedAt: string;
}

interface RawBoundAgent {
  agentId: PlatformId;
  envVar: string;
  expose: AppOverviewBoundAgentExposure;
  name: string;
}

function toNativeWebFact(web: RawNativeWebFact): { agent?: string; declared: boolean } {
  return { ...(web.agent === null ? {} : { agent: web.agent }), declared: web.declared };
}

/**
 * GraphQL delivers the native result with explicit `null`s where the contract
 * omits optional keys and plain `String` where the contract has closed unions.
 * Rebuild the canonical serialized shape and reuse the strict contract parser,
 * so the web sees exactly the closed-set semantics the API persisted (unknown
 * codes → `null`, same as a corrupted row). Exported for the web test suite;
 * the app consumes it only through {@link toAppDeploymentRun}.
 */
export function toNativeRunResult(
  native: RawNativeRunResult | null,
): NativeDeploymentRunResult | null {
  if (native === null) {
    return null;
  }

  const candidate = {
    facts:
      native.facts === null
        ? null
        : {
            agentCount: native.facts.agentCount,
            agents: native.facts.agents.map((agent) => ({
              action: agent.action,
              exposed: agent.exposed,
              name: agent.name,
              ...(agent.versionNumber === null ? {} : { versionNumber: agent.versionNumber }),
            })),
            specVersion: native.facts.specVersion,
            web: toNativeWebFact(native.facts.web),
          },
    validate: {
      facts:
        native.validate.facts === null
          ? null
          : {
              agentCount: native.validate.facts.agentCount,
              agents: native.validate.facts.agents.map((agent) => ({
                exposed: agent.exposed,
                name: agent.name,
                source: agent.source,
              })),
              spec: native.validate.facts.spec,
              web: toNativeWebFact(native.validate.facts.web),
            },
      failures: native.validate.failures.map((failure) => ({
        action: failure.action,
        code: failure.code,
        ...(failure.field === null ? {} : { field: failure.field }),
        file: failure.file,
        problem: failure.problem,
        severity: failure.severity,
      })),
      schemaVersion: native.validate.schemaVersion,
      valid: native.validate.valid,
    },
  };

  return parseNativeDeploymentRunResult(JSON.stringify(candidate));
}

function toAppDeploymentRun(run: RawDeploymentRun): AppDeploymentRun {
  return {
    appId: toAppId(run.appId),
    createdAt: run.createdAt,
    deploymentId: toAppDeploymentId(run.deploymentId),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    id: toAppDeploymentRunId(run.id),
    liveUrl: run.liveUrl,
    native: toNativeRunResult(run.native),
    plannedUrl: run.plannedUrl,
    sourceBranch: run.sourceBranch,
    sourceCommitSha: run.sourceCommitSha,
    status: run.status,
    targetKind: run.targetKind,
    updatedAt: run.updatedAt,
  };
}

function toAppDeployment(deployment: RawDeployment): AppDeployment {
  return {
    appId: toAppId(deployment.appId),
    createdAt: deployment.createdAt,
    defaultBranch: deployment.defaultBranch,
    id: toAppDeploymentId(deployment.id),
    latestRun: deployment.latestRun === null ? null : toAppDeploymentRun(deployment.latestRun),
    liveUrl: deployment.liveUrl,
    plannedUrl: deployment.plannedUrl,
    repoName: deployment.repoName,
    repoOwner: deployment.repoOwner,
    repoUrl: deployment.repoUrl,
    updatedAt: deployment.updatedAt,
  };
}

function toBoundAgent(agent: RawBoundAgent): AppOverviewBoundAgent {
  return {
    agentId: toAgentId(agent.agentId),
    envVar: agent.envVar,
    expose: agent.expose,
    name: agent.name,
  };
}

export async function getAppDeploymentOverview(appId: AppId): Promise<AppDeploymentOverview> {
  const payload = await requestGraphQL(APP_DEPLOYMENT_OVERVIEW_QUERY, { appId });
  const { app, boundAgents, deployment } = payload.appOverview;

  return {
    appName: app.name,
    boundAgents: boundAgents.map(toBoundAgent),
    deployment: deployment === null ? null : toAppDeployment(deployment),
  };
}

/** Deployment runs for the App, newest first (server default 20, cap 50). */
export async function listAppDeploymentRuns(
  appId: AppId,
  limit?: number,
): Promise<AppDeploymentRun[]> {
  const payload = await requestGraphQL(APP_DEPLOYMENT_RUN_LIST_QUERY, {
    appId,
    limit: limit ?? null,
  });

  return payload.appDeploymentRunList.map(toAppDeploymentRun);
}

export async function deployApp(input: DeployAppInput): Promise<AppDeploymentRun> {
  const payload = await requestGraphQL(DEPLOY_APP_MUTATION, { input });

  return toAppDeploymentRun(payload.deployApp);
}

export async function deleteAppDeployment(input: DeleteAppDeploymentInput): Promise<boolean> {
  const payload = await requestGraphQL(DELETE_APP_DEPLOYMENT_MUTATION, { input });

  return payload.deleteAppDeployment.ok;
}
