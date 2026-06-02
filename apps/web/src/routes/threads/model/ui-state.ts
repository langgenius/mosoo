import { useCallback, useMemo, useState } from "react";

import type { ThreadFilter, ThreadSection } from "./thread";

export interface ThreadUiState {
  collapsedSections: Record<ThreadSection, boolean>;
  dismissedNotificationPrompt: boolean;
  filter: ThreadFilter;
  lastAgentId: string | null;
}

export interface ThreadUiStateController {
  setDismissedNotificationPrompt: (dismissed: boolean) => void;
  setFilter: (filter: ThreadFilter) => void;
  setLastAgentId: (agentId: string | null) => void;
  setSectionCollapsed: (section: ThreadSection, collapsed: boolean) => void;
  state: ThreadUiState;
}

const DEFAULT_THREAD_UI_STATE: ThreadUiState = {
  collapsedSections: {
    archived: true,
    completed: false,
    pinned: false,
    working: false,
  },
  dismissedNotificationPrompt: false,
  filter: "all",
  lastAgentId: null,
};

const THREAD_FILTERS = new Set<ThreadFilter>(["all", "failed", "pinned", "unread"]);
const THREAD_SECTIONS: ThreadSection[] = ["pinned", "working", "completed", "archived"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCollapsedSections(value: unknown): Record<ThreadSection, boolean> {
  const input = isRecord(value) ? value : {};
  const result: Record<ThreadSection, boolean> = { ...DEFAULT_THREAD_UI_STATE.collapsedSections };

  for (const section of THREAD_SECTIONS) {
    if (section in input) {
      result[section] = input[section] === true;
    }
  }

  return result;
}

function isThreadFilter(value: unknown): value is ThreadFilter {
  return value === "all" || value === "failed" || value === "pinned" || value === "unread";
}

function readThreadFilter(value: unknown): ThreadFilter {
  return isThreadFilter(value) && THREAD_FILTERS.has(value)
    ? value
    : DEFAULT_THREAD_UI_STATE.filter;
}

function toStorageKey(input: {
  organizationId: string | null;
  userId: string | null;
}): string | null {
  if (input.organizationId === null || input.userId === null) {
    return null;
  }

  return `mosoo.threads.ui:${input.userId}:${input.organizationId}`;
}

function loadThreadUiState(storageKey: string | null): ThreadUiState {
  if (storageKey === null) {
    return DEFAULT_THREAD_UI_STATE;
  }

  try {
    const rawValue = globalThis.localStorage.getItem(storageKey);

    if (rawValue === null) {
      return DEFAULT_THREAD_UI_STATE;
    }

    const parsed: unknown = JSON.parse(rawValue);

    if (!isRecord(parsed)) {
      return DEFAULT_THREAD_UI_STATE;
    }

    return {
      collapsedSections: readCollapsedSections(parsed["collapsedSections"]),
      dismissedNotificationPrompt: parsed["dismissedNotificationPrompt"] === true,
      filter: readThreadFilter(parsed["filter"]),
      lastAgentId: typeof parsed["lastAgentId"] === "string" ? parsed["lastAgentId"] : null,
    };
  } catch {
    globalThis.localStorage.removeItem(storageKey);
    return DEFAULT_THREAD_UI_STATE;
  }
}

function persistThreadUiState(storageKey: string | null, state: ThreadUiState): void {
  if (storageKey === null) {
    return;
  }

  globalThis.localStorage.setItem(storageKey, JSON.stringify(state));
}

export function useThreadUiState(input: {
  organizationId: string | null;
  userId: string | null;
}): ThreadUiStateController {
  const { organizationId, userId } = input;
  const storageKey = useMemo(
    () => toStorageKey({ organizationId, userId }),
    [organizationId, userId],
  );
  const [state, setState] = useState<ThreadUiState>(() => loadThreadUiState(storageKey));

  const updateState = useCallback(
    (updater: (current: ThreadUiState) => ThreadUiState) => {
      setState((current) => {
        const next = updater(current);

        if (next !== current) {
          persistThreadUiState(storageKey, next);
        }

        return next;
      });
    },
    [storageKey],
  );

  const setSectionCollapsed = useCallback(
    (section: ThreadSection, collapsed: boolean) => {
      updateState((current) => {
        if (current.collapsedSections[section] === collapsed) {
          return current;
        }

        return {
          ...current,
          collapsedSections: {
            ...current.collapsedSections,
            [section]: collapsed,
          },
        };
      });
    },
    [updateState],
  );

  const setDismissedNotificationPrompt = useCallback(
    (dismissed: boolean) => {
      updateState((current) =>
        current.dismissedNotificationPrompt === dismissed
          ? current
          : { ...current, dismissedNotificationPrompt: dismissed },
      );
    },
    [updateState],
  );

  const setFilter = useCallback(
    (filter: ThreadFilter) => {
      updateState((current) => (current.filter === filter ? current : { ...current, filter }));
    },
    [updateState],
  );

  const setLastAgentId = useCallback(
    (agentId: string | null) => {
      updateState((current) =>
        current.lastAgentId === agentId ? current : { ...current, lastAgentId: agentId },
      );
    },
    [updateState],
  );

  return useMemo(
    () => ({
      setDismissedNotificationPrompt,
      setFilter,
      setLastAgentId,
      setSectionCollapsed,
      state,
    }),
    [setDismissedNotificationPrompt, setFilter, setLastAgentId, setSectionCollapsed, state],
  );
}
