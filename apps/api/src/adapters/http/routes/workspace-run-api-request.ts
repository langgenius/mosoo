import type { CreateWorkspaceRunRequest, HarnessSlug, RunInput } from "@mosoo/contracts/harness";
import { HARNESS_SLUGS } from "@mosoo/contracts/harness";
import { PUBLIC_THREAD_JSON_BODY_MAX_BYTES } from "@mosoo/contracts/public-api";

import { publicInvalidRequest } from "../../../modules/public-api/public-api-errors";
import { readJsonBodyWithLimit } from "./public-thread-api-request";

interface RawJsonRequestContext {
  req: {
    raw: Request;
  };
}

export interface WorkspaceRunApprovalRequest {
  decision: "allow_once" | "reject_once";
  requestId: string;
}

const RUN_FIELDS: ReadonlySet<string> = new Set([
  "agent",
  "environment",
  "harness",
  "input",
  "model",
  "profile",
]);
const APPROVAL_FIELDS: ReadonlySet<string> = new Set(["decision", "requestId"]);

function readObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw publicInvalidRequest("Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function assertOnlyFields(
  input: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  for (const field of Object.keys(input)) {
    if (!allowedFields.has(field)) {
      throw publicInvalidRequest(`Unsupported request field: ${field}.`);
    }
  }
}

function readOptionalNonEmptyString(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw publicInvalidRequest(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function readRequiredNonEmptyString(input: Record<string, unknown>, field: string): string {
  const value = readOptionalNonEmptyString(input, field);

  if (value === undefined) {
    throw publicInvalidRequest(`${field} is required.`);
  }

  return value;
}

function readHarnessSlug(value: string): HarnessSlug {
  if ((HARNESS_SLUGS as readonly string[]).includes(value)) {
    return value as HarnessSlug;
  }

  throw publicInvalidRequest(`harness must be one of: ${HARNESS_SLUGS.join(", ")}.`);
}

export async function readCreateWorkspaceRunRequest(
  c: RawJsonRequestContext,
): Promise<CreateWorkspaceRunRequest> {
  const body = readObject(await readJsonBodyWithLimit(c, PUBLIC_THREAD_JSON_BODY_MAX_BYTES));
  assertOnlyFields(body, RUN_FIELDS);

  if (!Object.hasOwn(body, "input")) {
    throw publicInvalidRequest("input is required.");
  }

  const input = body["input"] as RunInput;
  const agent = readOptionalNonEmptyString(body, "agent");
  const harnessValue = readOptionalNonEmptyString(body, "harness");

  if ((agent === undefined) === (harnessValue === undefined)) {
    throw publicInvalidRequest("Exactly one of agent or harness is required.");
  }

  if (agent !== undefined) {
    if (
      body["environment"] !== undefined ||
      body["model"] !== undefined ||
      body["profile"] !== undefined
    ) {
      throw publicInvalidRequest("environment, model, and profile can only be used with harness.");
    }

    return { agent, input };
  }

  const environment = readOptionalNonEmptyString(body, "environment");
  const model = readOptionalNonEmptyString(body, "model");
  const profile = readOptionalNonEmptyString(body, "profile");
  const harness = readHarnessSlug(harnessValue as string);

  return {
    ...(environment === undefined ? {} : { environment }),
    harness,
    input,
    ...(model === undefined ? {} : { model }),
    ...(profile === undefined ? {} : { profile }),
  };
}

export async function readWorkspaceRunApprovalRequest(
  c: RawJsonRequestContext,
): Promise<WorkspaceRunApprovalRequest> {
  const body = readObject(await readJsonBodyWithLimit(c, PUBLIC_THREAD_JSON_BODY_MAX_BYTES));
  assertOnlyFields(body, APPROVAL_FIELDS);
  const requestId = readRequiredNonEmptyString(body, "requestId");
  const decision = body["decision"];

  if (decision !== "allow_once" && decision !== "reject_once") {
    throw publicInvalidRequest("decision must be allow_once or reject_once.");
  }

  return { decision, requestId };
}
