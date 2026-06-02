import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { rejectSessionPermissionRequests } from "../../../runtime/application/session-run.service";
import { appendSessionRuntimeEvents } from "../../application/session-event-write.service";
import type { SessionLiveState } from "../session-live-state.types";
import type { ViewerSocketAttachment } from "./viewer-socket";

export interface PermissionStateUpdateResult {
  state: SessionLiveState;
}

interface RejectDisconnectedViewerPermissionRequestsInput {
  attachment: ViewerSocketAttachment;
  cachedState: SessionLiveState | null;
  env: ApiBindings;
  onPermissionCleanupError: (error: unknown, requestId: string) => void;
}

export async function rejectDisconnectedViewerPermissionRequests(
  input: RejectDisconnectedViewerPermissionRequestsInput,
): Promise<PermissionStateUpdateResult | null> {
  const result = await rejectSessionPermissionRequests({
    bindings: input.env,
    cachedState: input.cachedState,
    onPermissionCleanupError: input.onPermissionCleanupError,
    sessionId: input.attachment.sessionId,
    viewer: input.attachment.viewer,
  });

  if (result === null) {
    return null;
  }

  await appendSessionRuntimeEvents({
    bindings: input.env,
    deliver: false,
    events: [result.event],
    sessionId: input.attachment.sessionId,
  });

  return { state: result.state };
}
