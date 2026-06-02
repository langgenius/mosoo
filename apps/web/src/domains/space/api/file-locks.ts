import type { SpaceId } from "@mosoo/contracts/id";
import type {
  AcquireSpaceFileLockRequest,
  AcquireSpaceFileLockResponse,
  ReleaseSpaceFileLockRequest,
  ReleaseSpaceFileLockResponse,
} from "@mosoo/contracts/space";

import { requestJson } from "@/platform/http/file-request";

export async function acquireSpaceFileLock(
  spaceId: SpaceId,
  input: AcquireSpaceFileLockRequest,
): Promise<AcquireSpaceFileLockResponse> {
  return requestJson<AcquireSpaceFileLockResponse, AcquireSpaceFileLockRequest>(
    `/space/${spaceId}/locks/acquire`,
    {
      bodyJson: input,
      method: "POST",
    },
  );
}

export async function releaseSpaceFileLock(
  spaceId: SpaceId,
  input: ReleaseSpaceFileLockRequest,
): Promise<ReleaseSpaceFileLockResponse> {
  return requestJson<ReleaseSpaceFileLockResponse, ReleaseSpaceFileLockRequest>(
    `/space/${spaceId}/locks/release`,
    {
      bodyJson: input,
      method: "POST",
    },
  );
}
