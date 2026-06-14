import type { SpaceView } from "@mosoo/contracts/space";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAppSession } from "../../app/session-provider";
import { spaces as listSpaces } from "../../domains/space/api/list";
import { spaceKeys, useSpacesQuery } from "../../domains/space/query/space-queries";
import { toAppId } from "../typed-id";

interface SpaceUiState {
  activeSpace: string | null;
  currentPath: string;
  hoveredSpace: string | null;
}

interface SpaceListModel {
  activeSpace: string | null;
  currentPath: string;
  hoveredSpace: string | null;
  loading: boolean;
  appId: string | null;
  refreshSpaces: (nextAppId?: string | null) => Promise<SpaceView[]>;
  selectSpace: (spaceId: string | null) => void;
  setCurrentPath: (currentPath: string) => void;
  setHoveredSpace: (hoveredSpace: string | null) => void;
  spaces: SpaceView[];
}

const DEFAULT_SPACE_UI_STATE: SpaceUiState = {
  activeSpace: null,
  currentPath: "",
  hoveredSpace: null,
};

const EMPTY_SPACES: SpaceView[] = [];

export function useSpaceList(): SpaceListModel {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeApp } = useAppSession();
  const [uiByApp, setUiByApp] = useState<Record<string, SpaceUiState>>({});
  const appId = activeApp?.id ?? null;
  const spacesQuery = useSpacesQuery(appId);
  const spaces = spacesQuery.data ?? EMPTY_SPACES;
  const currentUiState =
    appId === null ? DEFAULT_SPACE_UI_STATE : (uiByApp[appId] ?? DEFAULT_SPACE_UI_STATE);
  const requestedSpaceId = searchParams.get("space");
  const activeSpaceFromUrl =
    appId !== null &&
    requestedSpaceId !== null &&
    spaces.some((space) => space.id === requestedSpaceId)
      ? requestedSpaceId
      : null;
  const activeSpaceFromState =
    appId !== null &&
    currentUiState.activeSpace !== null &&
    spaces.some((space) => space.id === currentUiState.activeSpace)
      ? currentUiState.activeSpace
      : null;
  const activeSpace = activeSpaceFromUrl ?? activeSpaceFromState;

  function updateAppUi(transform: (current: SpaceUiState) => SpaceUiState): void {
    if (appId === null) {
      return;
    }

    setUiByApp((current) => ({
      ...current,
      [appId]: transform(current[appId] ?? DEFAULT_SPACE_UI_STATE),
    }));
  }

  async function refreshSpaces(nextAppId: string | null = appId): Promise<SpaceView[]> {
    if (nextAppId === null) {
      return [];
    }

    await queryClient.invalidateQueries({
      queryKey: spaceKeys.list(toAppId(nextAppId)),
    });
    const nextSpaces = await queryClient.fetchQuery({
      queryFn: async () => listSpaces(toAppId(nextAppId)),
      queryKey: spaceKeys.list(toAppId(nextAppId)),
    });
    return nextSpaces;
  }

  function selectSpace(spaceId: string | null): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);

        if (spaceId === null) {
          next.delete("space");
        } else {
          next.set("space", spaceId);
        }

        return next;
      },
      { replace: false },
    );
    updateAppUi((current) => ({
      ...current,
      activeSpace: spaceId,
      currentPath: "",
    }));
  }

  return {
    activeSpace,
    currentPath: currentUiState.currentPath,
    hoveredSpace: currentUiState.hoveredSpace,
    loading: spacesQuery.isLoading,
    appId,
    refreshSpaces,
    selectSpace,
    setCurrentPath(currentPath: string) {
      updateAppUi((current) => ({
        ...current,
        currentPath,
      }));
    },
    setHoveredSpace(hoveredSpace: string | null) {
      updateAppUi((current) => ({
        ...current,
        hoveredSpace,
      }));
    },
    spaces,
  };
}
