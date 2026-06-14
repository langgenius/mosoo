import type { AppId, SpaceId } from "@mosoo/contracts/id";
import type {
  AcquireSpaceFileLockRequest,
  AcquireSpaceFileLockResponse,
  ReleaseSpaceFileLockRequest,
  ReleaseSpaceFileLockResponse,
} from "@mosoo/contracts/space";

import { requestJson } from "@/platform/http/file-request";

export async function acquireSpaceFileLock(
  appId: AppId,
  spaceId: SpaceId,
  input: AcquireSpaceFileLockRequest,
): Promise<AcquireSpaceFileLockResponse> {
  return requestJson<AcquireSpaceFileLockResponse, AcquireSpaceFileLockRequest>(
    `/apps/${appId}/spaces/${spaceId}/locks/acquire`,
    {
      bodyJson: input,
      method: "POST",
    },
  );
}

export async function releaseSpaceFileLock(
  appId: AppId,
  spaceId: SpaceId,
  input: ReleaseSpaceFileLockRequest,
): Promise<ReleaseSpaceFileLockResponse> {
  return requestJson<ReleaseSpaceFileLockResponse, ReleaseSpaceFileLockRequest>(
    `/apps/${appId}/spaces/${spaceId}/locks/release`,
    {
      bodyJson: input,
      method: "POST",
    },
  );
}
