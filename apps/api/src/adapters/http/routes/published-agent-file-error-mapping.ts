import type { FileControlError } from "../../../modules/files/application/file-control-errors";
import type { PublishedAgentApiError } from "../../../modules/public-api/published-agent-api-errors";
import {
  publicForbidden,
  publicInternalError,
  publicInvalidRequest,
  publicNotFound,
  publicUnauthenticated,
} from "../../../modules/public-api/published-agent-api-errors";

export function mapFileControlErrorToPublicApiError(
  error: FileControlError,
): PublishedAgentApiError {
  switch (error.status) {
    case 400:
    case 409:
    case 410:
    case 412: {
      return publicInvalidRequest(error.message);
    }
    case 401: {
      return publicUnauthenticated(error.message);
    }
    case 403: {
      return publicForbidden(error.message);
    }
    case 404: {
      return publicNotFound(error.message);
    }
    default: {
      return publicInternalError();
    }
  }
}
