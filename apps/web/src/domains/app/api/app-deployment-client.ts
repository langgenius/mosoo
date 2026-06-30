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

const APP_DEPLOYMENT_STATUS_QUERY = graphql(/* GraphQL */ `
  query AppDeploymentStatus($appId: ULID!) {
    appDeploymentStatus(appId: $appId) {
      appId
      createdAt
      deploymentId
      errorCode
      errorMessage
      id
      liveUrl
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

interface RawDeploymentRun {
  appId: PlatformId;
  createdAt: string;
  deploymentId: PlatformId;
  errorCode: string | null;
  errorMessage: string | null;
  id: PlatformId;
  liveUrl: string | null;
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

function toAppDeploymentRun(run: RawDeploymentRun): AppDeploymentRun {
  return {
    appId: toAppId(run.appId),
    createdAt: run.createdAt,
    deploymentId: toAppDeploymentId(run.deploymentId),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    id: toAppDeploymentRunId(run.id),
    liveUrl: run.liveUrl,
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

export async function getAppDeploymentStatus(appId: AppId): Promise<AppDeploymentRun | null> {
  const payload = await requestGraphQL(APP_DEPLOYMENT_STATUS_QUERY, { appId });

  return payload.appDeploymentStatus === null
    ? null
    : toAppDeploymentRun(payload.appDeploymentStatus);
}

export async function deployApp(input: DeployAppInput): Promise<AppDeploymentRun> {
  const payload = await requestGraphQL(DEPLOY_APP_MUTATION, { input });

  return toAppDeploymentRun(payload.deployApp);
}

export async function deleteAppDeployment(input: DeleteAppDeploymentInput): Promise<boolean> {
  const payload = await requestGraphQL(DELETE_APP_DEPLOYMENT_MUTATION, { input });

  return payload.deleteAppDeployment.ok;
}
