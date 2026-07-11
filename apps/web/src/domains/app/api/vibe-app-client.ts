import type { AppVibeApp, AppVibeAppCloneUrl, AppVibeAppStatus } from "@mosoo/contracts/app";
import type { AppId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAppId, toAppVibeAppId } from "@/routes/typed-id";

/**
 * Strongly typed GraphQL access for the Vibe App console on App Overview.
 * `graphql()` tagged documents drive `requestGraphQL`, and the raw payloads
 * are mapped back onto the shared `@mosoo/contracts/app` domain types.
 */

const APP_VIBE_APP_QUERY = graphql(/* GraphQL */ `
  query AppVibeApp($appId: ULID!) {
    appVibeApp(appId: $appId) {
      appId
      createdAt
      id
      previewUrl
      productionUrl
      status
      title
      updatedAt
      vibeAppId
    }
  }
`);

const CREATE_APP_VIBE_APP_MUTATION = graphql(/* GraphQL */ `
  mutation CreateAppVibeApp($input: CreateAppVibeAppInput!) {
    createAppVibeApp(input: $input) {
      appId
      createdAt
      id
      previewUrl
      productionUrl
      status
      title
      updatedAt
      vibeAppId
    }
  }
`);

const SEND_APP_VIBE_APP_PROMPT_MUTATION = graphql(/* GraphQL */ `
  mutation SendAppVibeAppPrompt($input: SendAppVibeAppPromptInput!) {
    sendAppVibeAppPrompt(input: $input) {
      ok
    }
  }
`);

const PUBLISH_APP_VIBE_APP_MUTATION = graphql(/* GraphQL */ `
  mutation PublishAppVibeApp($input: PublishAppVibeAppInput!) {
    publishAppVibeApp(input: $input) {
      ok
    }
  }
`);

const REFRESH_APP_VIBE_APP_PREVIEW_MUTATION = graphql(/* GraphQL */ `
  mutation RefreshAppVibeAppPreview($input: RefreshAppVibeAppPreviewInput!) {
    refreshAppVibeAppPreview(input: $input) {
      ok
    }
  }
`);

const CREATE_APP_VIBE_APP_CLONE_URL_MUTATION = graphql(/* GraphQL */ `
  mutation CreateAppVibeAppCloneUrl($input: CreateAppVibeAppCloneUrlInput!) {
    createAppVibeAppCloneUrl(input: $input) {
      cloneUrl
      expiresAt
    }
  }
`);

const DELETE_APP_VIBE_APP_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteAppVibeApp($input: DeleteAppVibeAppInput!) {
    deleteAppVibeApp(input: $input) {
      ok
    }
  }
`);

interface RawVibeApp {
  appId: string;
  createdAt: string;
  id: string;
  previewUrl: string | null;
  productionUrl: string | null;
  status: string;
  title: string | null;
  updatedAt: string;
  vibeAppId: string;
}

function toVibeAppStatus(value: string): AppVibeAppStatus {
  if (value !== "generating" && value !== "ready") {
    throw new Error(`Unknown vibe app status: ${value}`);
  }

  return value;
}

function toVibeApp(raw: RawVibeApp): AppVibeApp {
  return {
    appId: toAppId(raw.appId),
    createdAt: raw.createdAt,
    id: toAppVibeAppId(raw.id),
    previewUrl: raw.previewUrl,
    productionUrl: raw.productionUrl,
    status: toVibeAppStatus(raw.status),
    title: raw.title,
    updatedAt: raw.updatedAt,
    vibeAppId: raw.vibeAppId,
  };
}

export async function getAppVibeApp(appId: AppId): Promise<AppVibeApp | null> {
  const data = await requestGraphQL(APP_VIBE_APP_QUERY, { appId });
  return data.appVibeApp === null || data.appVibeApp === undefined
    ? null
    : toVibeApp(data.appVibeApp);
}

export async function createAppVibeApp(appId: AppId, prompt: string): Promise<AppVibeApp> {
  const data = await requestGraphQL(CREATE_APP_VIBE_APP_MUTATION, { input: { appId, prompt } });
  return toVibeApp(data.createAppVibeApp);
}

export async function sendAppVibeAppPrompt(appId: AppId, prompt: string): Promise<void> {
  await requestGraphQL(SEND_APP_VIBE_APP_PROMPT_MUTATION, { input: { appId, prompt } });
}

export async function publishAppVibeApp(appId: AppId): Promise<void> {
  await requestGraphQL(PUBLISH_APP_VIBE_APP_MUTATION, { input: { appId } });
}

export async function refreshAppVibeAppPreview(appId: AppId): Promise<void> {
  await requestGraphQL(REFRESH_APP_VIBE_APP_PREVIEW_MUTATION, { input: { appId } });
}

export async function createAppVibeAppCloneUrl(appId: AppId): Promise<AppVibeAppCloneUrl> {
  const data = await requestGraphQL(CREATE_APP_VIBE_APP_CLONE_URL_MUTATION, { input: { appId } });
  return data.createAppVibeAppCloneUrl;
}

export async function deleteAppVibeApp(appId: AppId): Promise<void> {
  await requestGraphQL(DELETE_APP_VIBE_APP_MUTATION, { input: { appId } });
}
