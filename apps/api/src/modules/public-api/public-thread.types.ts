import type { PublicApiVersion } from "@mosoo/contracts/public-api";
import type { AgentId, FileId, ProjectId, PublicThreadId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { PersonalAccessTokenCaller } from "../auth/application/personal-access-token.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";

export interface CreatePublicThreadInput {
  maxCostUsd?: number;
  fileIds: FileId[];
  inputText?: string | undefined;
  userId: string | null;
}

export interface CreatePublicThreadRequest {
  apiVersion?: PublicApiVersion | undefined;
  source: PublicThreadCreationSource;
  bindings: ApiBindings;
  caller: PersonalAccessTokenCaller;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  idempotencyKey: string | null;
  idempotencyCreatedAt?: number;
  input: CreatePublicThreadInput;
  requestUrl: string;
}

export type PublicThreadCreationSource =
  | { type: "agent"; agentId: AgentId }
  | {
      type: "inline";
      projectId: ProjectId;
      runtimeId: string;
      provider: string;
      model: string;
      instructions: string;
    };

export interface RetrievePublicThreadRequest {
  apiVersion?: PublicApiVersion | undefined;
  caller: AuthenticatedViewer;
  database: D1Database;
  threadId: PublicThreadId;
}

export interface ListPublicThreadEventsRequest {
  apiVersion?: PublicApiVersion | undefined;
  caller: AuthenticatedViewer;
  database: D1Database;
  limit: number;
  threadId: PublicThreadId;
}

export interface StreamPublicThreadEventsRequest extends ListPublicThreadEventsRequest {
  bindings: ApiBindings;
  signal?: AbortSignal | null | undefined;
}
