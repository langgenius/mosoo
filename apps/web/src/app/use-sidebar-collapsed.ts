import { useCallback, useState } from "react";

const STORAGE_KEY = "mosoo:sidebar-collapsed";

function readInitialCollapsed(): boolean {
  if (globalThis.window === undefined) {
    return false;
  }
  return globalThis.localStorage.getItem(STORAGE_KEY) === "true";
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      globalThis.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { collapsed, toggleCollapsed };
}
