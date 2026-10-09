import type { FileId, ProjectId, SessionId, SessionRunId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";

export interface EnvironmentPackageArtifactBuildCommandPayload {
  projectId: ProjectId;
  artifactAbi: string;
  inputDigest: string;
  packages: { manager: "npm" | "pip"; packages: string[] }[];
}

export interface SessionRunDispatchCommandPayload {
  accessViewer?: AuthenticatedViewer;
  attachmentIds: FileId[];
  prompt: string;
  queuedAtMs: number;
  requestUrl: string;
  session: {
    id: SessionId;
    project_id: ProjectId;
  };
  sessionRunId: SessionRunId;
  traceId: string;
  viewer: AuthenticatedViewer;
}

// Retrying cannot succeed: the processor records the failure and acknowledges
// the message instead of spending the Queue retry budget.
export class ApiCommandPermanentError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiCommandPermanentError";
    this.code = code;
  }
}
