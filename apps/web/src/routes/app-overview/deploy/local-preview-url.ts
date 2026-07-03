import { useCallback, useEffect, useState } from "react";

const LOCAL_PREVIEW_STORAGE_KEY = "mosoo.appDeployment.localPreviewUrl";
const DEFAULT_LOCAL_PREVIEW_URL = "http://localhost:8877/";
const LOCAL_PREVIEW_CHECK_INTERVAL_MS = 10_000;
const LOCAL_PREVIEW_CHECK_TIMEOUT_MS = 1_800;

export type LocalDeploymentPreviewStatus = "checking" | "offline" | "online" | "unavailable";

export interface LocalDeploymentPreviewState {
  status: LocalDeploymentPreviewStatus;
  url: string | null;
  refresh: () => void;
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isLoopbackConsoleHost(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export function getLocalDeploymentPreviewUrl(): string | null {
  const fromEnv = normalizeHttpUrl(import.meta.env.VITE_APP_DEPLOYMENT_LOCAL_PREVIEW_URL);
  if (fromEnv !== null) {
    return fromEnv;
  }

  const fromStorage =
    typeof window === "undefined"
      ? null
      : normalizeHttpUrl(window.localStorage.getItem(LOCAL_PREVIEW_STORAGE_KEY));
  if (fromStorage !== null) {
    return fromStorage;
  }

  return isLoopbackConsoleHost() ? DEFAULT_LOCAL_PREVIEW_URL : null;
}

export function getLocalDeploymentPreviewHealthUrl(previewUrl: string): string {
  const healthUrl = new URL(previewUrl);
  healthUrl.pathname = "/healthz";
  healthUrl.search = "";
  healthUrl.hash = "";
  return healthUrl.toString();
}

async function checkLocalDeploymentPreview(
  previewUrl: string,
): Promise<LocalDeploymentPreviewStatus> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), LOCAL_PREVIEW_CHECK_TIMEOUT_MS);

  try {
    await fetch(getLocalDeploymentPreviewHealthUrl(previewUrl), {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    });
    return "online";
  } catch {
    return "offline";
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function useLocalDeploymentPreview(): LocalDeploymentPreviewState {
  const url = getLocalDeploymentPreviewUrl();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [status, setStatus] = useState<LocalDeploymentPreviewStatus>(
    url === null ? "unavailable" : "checking",
  );
  const refresh = useCallback(() => {
    setStatus(url === null ? "unavailable" : "checking");
    setRefreshNonce((current) => current + 1);
  }, [url]);

  useEffect(() => {
    if (url === null) {
      setStatus("unavailable");
      return;
    }

    let active = true;

    const previewUrl = url;

    async function refreshStatus(): Promise<void> {
      setStatus((current) =>
        current === "online" || current === "offline" ? current : "checking",
      );
      const nextStatus = await checkLocalDeploymentPreview(previewUrl);
      if (active) {
        setStatus(nextStatus);
      }
    }

    void refreshStatus();
    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, LOCAL_PREVIEW_CHECK_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [refreshNonce, url]);

  return { refresh, status, url };
}
