import type { AgentId, FileId, PublicThreadId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { PersonalAccessTokenCaller } from "../auth/application/personal-access-token.service";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";

export interface CreatePublicThreadInput {
  fileIds: FileId[];
  inputText?: string | undefined;
  userId: string;
}

export interface CreatePublicThreadRequest {
  agentId: AgentId;
  bindings: ApiBindings;
  caller: PersonalAccessTokenCaller;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  idempotencyKey: string | null;
  input: CreatePublicThreadInput;
  requestUrl: string;
}

export interface RetrievePublicThreadRequest {
  caller: AuthenticatedViewer;
  database: D1Database;
  threadId: PublicThreadId;
}

export interface ListPublicThreadEventsRequest {
  caller: AuthenticatedViewer;
  database: D1Database;
  limit: number;
  threadId: PublicThreadId;
}

export interface StreamPublicThreadEventsRequest extends ListPublicThreadEventsRequest {
  bindings: ApiBindings;
  signal?: AbortSignal | null | undefined;
}
