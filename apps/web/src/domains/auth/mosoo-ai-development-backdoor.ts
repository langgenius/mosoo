import {
  canUseMosooAiDevelopmentBackdoor,
  isDevelopmentBackdoorLoopbackOrigin,
} from "@mosoo/development-auth";
import type { BetterAuthClientPlugin } from "better-auth/client";

import { apiFetch } from "@/platform/http/public-api";

interface MosooAiDevelopmentBackdoorSignInPayload {
  email: string;
}

interface MosooAiDevelopmentBackdoorSignInResponse {
  token: string;
  user: {
    email: string;
    id: string;
    image?: string | null;
    name: string;
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

function parseBackdoorError(value: unknown): string | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const { error } = value;
  const errorMessage = isJsonObject(error) ? error["message"] : undefined;
  if (typeof errorMessage === "string") {
    return errorMessage;
  }

  const message = value["message"];
  return typeof message === "string" ? message : null;
}

function parseBackdoorUser(value: unknown): MosooAiDevelopmentBackdoorSignInResponse["user"] {
  if (!isJsonObject(value)) {
    throw new Error("Invalid development sign-in response.");
  }

  const { email, id, image, name } = value;

  if (
    typeof email !== "string" ||
    typeof id !== "string" ||
    typeof name !== "string" ||
    (image !== undefined && image !== null && typeof image !== "string")
  ) {
    throw new Error("Invalid development sign-in response.");
  }

  return {
    email,
    id,
    ...(image === undefined ? {} : { image }),
    name,
  };
}

function parseBackdoorSignInResponse(value: unknown): MosooAiDevelopmentBackdoorSignInResponse {
  if (!isJsonObject(value) || typeof value["token"] !== "string") {
    throw new Error("Invalid development sign-in response.");
  }

  return {
    token: value["token"],
    user: parseBackdoorUser(value["user"]),
  };
}

function getDevelopmentBackdoorBrowserOrigin(): string | null {
  return globalThis.window.location.origin;
}

export function isMosooAiDevelopmentBackdoorEnabled(): boolean {
  const developmentBackdoorOrigin = getDevelopmentBackdoorBrowserOrigin();
  return developmentBackdoorOrigin === null
    ? false
    : isDevelopmentBackdoorLoopbackOrigin(developmentBackdoorOrigin);
}

export function shouldUseMosooAiDevelopmentBackdoor(email: string): boolean {
  const developmentBackdoorOrigin = getDevelopmentBackdoorBrowserOrigin();
  return developmentBackdoorOrigin === null
    ? false
    : canUseMosooAiDevelopmentBackdoor(email, developmentBackdoorOrigin);
}

export async function signInWithMosooAiDevelopmentBackdoor(
  email: string,
): Promise<MosooAiDevelopmentBackdoorSignInResponse> {
  const response = await apiFetch("/auth/development-backdoor/mosoo-ai-login", {
    body: JSON.stringify({ email: email.trim() }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = await readJson(response);

  if (response.ok) {
    return parseBackdoorSignInResponse(payload);
  }

  throw new Error(parseBackdoorError(payload) ?? `${response.status} ${response.statusText}`);
}

export function mosooAiDevelopmentBackdoorClientPlugin(): BetterAuthClientPlugin {
  return {
    getActions: ($fetch, $store) => ({
      signInWithMosooAiDevelopmentBackdoor: async (
        payload: MosooAiDevelopmentBackdoorSignInPayload,
      ) => {
        const developmentBackdoorResponse = await $fetch<MosooAiDevelopmentBackdoorSignInResponse>(
          "/development-backdoor/mosoo-ai-login",
          {
            body: {
              email: payload.email.trim(),
            },
            method: "POST",
          },
        );

        if (!developmentBackdoorResponse.error) {
          $store.notify("$sessionSignal");
        }

        return developmentBackdoorResponse;
      },
    }),
    id: "mosoo-ai-development-backdoor",
  } satisfies BetterAuthClientPlugin;
}
