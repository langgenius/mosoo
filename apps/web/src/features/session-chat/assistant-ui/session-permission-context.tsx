import type { SessionPermissionRequestView } from "@mosoo/ag-ui-session";
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

// Permission requests arrive as a separate live-state array, matched to tool
// calls by `toolCallId`. The runtime converter is identity-cached, so the
// needs_approval status cannot be folded into convertMessage — instead it is
// surfaced to the tool-part renderer through this context, which re-derives on
// every permissionRequests change.
const SessionPermissionContext = createContext<ReadonlyMap<string, SessionPermissionRequestView>>(
  new Map(),
);

export function SessionPermissionProvider({
  children,
  requests,
}: {
  children: ReactNode;
  requests: readonly SessionPermissionRequestView[];
}): ReactNode {
  const byToolCallId = useMemo(() => {
    const map = new Map<string, SessionPermissionRequestView>();

    for (const request of requests) {
      if (request.toolCallId !== null) {
        map.set(request.toolCallId, request);
      }
    }

    return map;
  }, [requests]);

  return (
    <SessionPermissionContext.Provider value={byToolCallId}>
      {children}
    </SessionPermissionContext.Provider>
  );
}

export function useSessionPermissionForToolCall(
  toolCallId: string | undefined,
): SessionPermissionRequestView | null {
  const byToolCallId = useContext(SessionPermissionContext);

  if (toolCallId === undefined) {
    return null;
  }

  return byToolCallId.get(toolCallId) ?? null;
}
