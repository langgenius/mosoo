import type { SpaceView } from "@mosoo/contracts/space";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useAppSession } from "../../app/session-provider";
import { spaces as listSpaces } from "../../domains/space/api/list";
import { spaceKeys, useSpacesQuery } from "../../domains/space/query/space-queries";
import { toOrganizationId } from "../typed-id";

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
  organizationId: string | null;
  refreshSpaces: (nextOrganizationId?: string | null) => Promise<SpaceView[]>;
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
  const { activeOrganization } = useAppSession();
  const [uiByOrganization, setUiByOrganization] = useState<Record<string, SpaceUiState>>({});
  const organizationId = activeOrganization?.id ?? null;
  const spacesQuery = useSpacesQuery(organizationId);
  const spaces = spacesQuery.data ?? EMPTY_SPACES;
  const currentUiState =
    organizationId === null
      ? DEFAULT_SPACE_UI_STATE
      : (uiByOrganization[organizationId] ?? DEFAULT_SPACE_UI_STATE);
  const requestedSpaceId = searchParams.get("space");
  const activeSpaceFromUrl =
    organizationId !== null &&
    requestedSpaceId !== null &&
    spaces.some((space) => space.id === requestedSpaceId)
      ? requestedSpaceId
      : null;
  const activeSpaceFromState =
    organizationId !== null &&
    currentUiState.activeSpace !== null &&
    spaces.some((space) => space.id === currentUiState.activeSpace)
      ? currentUiState.activeSpace
      : null;
  const activeSpace = activeSpaceFromUrl ?? activeSpaceFromState;

  function updateOrganizationUi(transform: (current: SpaceUiState) => SpaceUiState): void {
    if (organizationId === null) {
      return;
    }

    setUiByOrganization((current) => ({
      ...current,
      [organizationId]: transform(current[organizationId] ?? DEFAULT_SPACE_UI_STATE),
    }));
  }

  async function refreshSpaces(
    nextOrganizationId: string | null = organizationId,
  ): Promise<SpaceView[]> {
    if (nextOrganizationId === null) {
      return [];
    }

    await queryClient.invalidateQueries({
      queryKey: spaceKeys.list(toOrganizationId(nextOrganizationId)),
    });
    const nextSpaces = await queryClient.fetchQuery({
      queryFn: async () => listSpaces(toOrganizationId(nextOrganizationId)),
      queryKey: spaceKeys.list(toOrganizationId(nextOrganizationId)),
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
    updateOrganizationUi((current) => ({
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
    organizationId,
    refreshSpaces,
    selectSpace,
    setCurrentPath(currentPath: string) {
      updateOrganizationUi((current) => ({
        ...current,
        currentPath,
      }));
    },
    setHoveredSpace(hoveredSpace: string | null) {
      updateOrganizationUi((current) => ({
        ...current,
        hoveredSpace,
      }));
    },
    spaces,
  };
}
