/**
 * Pure / stack-free pieces of the bound-agent ask flow. Everything here is unit
 * testable without the Worker runtime, the DB, or the session runtime: capability
 * verification, the still-published guard, request-body parsing, the bounded
 * server-side wait for a terminal run, and final-output extraction. The
 * orchestration that wires these to the DB + session runtime lives in
 * `app-agent-bound-ask.service.ts`.
 */

import { PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH } from "@mosoo/contracts/public-api";
import type { PublicThreadFinalOutput } from "@mosoo/contracts/public-api";
import type { RunError, SessionRunStatus } from "@mosoo/contracts/session-run";

import type { AgentRow } from "../agents/application/agent-types";
import {
  boundAgentCallTimeout,
  boundAgentFinalOutputMissing,
  boundAgentNeedsInput,
  boundAgentRunFailed,
} from "./app-agent-bound-errors";
import { inspectAppAgentCapabilityToken } from "./app-agent-capability";
import type { AppAgentCapabilityClaims } from "./app-agent-capability";
import type { AppAgentCapabilityTokenVerification } from "./app-agent-capability";
import {
  publicAgentNotExposed,
  publicInvalidRequest,
  publicUnauthenticated,
} from "./public-api-errors";

export interface BoundAgentCallInput {
  message: string;
}

export type BoundAgentServabilityFailure = "agent_mismatched" | "agent_unpublished";

function readBoundAgentMessage(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw publicInvalidRequest("Request body must be a JSON object.");
  }

  const record = value as Record<string, unknown>;
  // Prefer a non-empty `message`; otherwise fall back to `input` (so an empty
  // `message` alongside a real `input` is not rejected).
  const messageField = record["message"];
  const raw =
    typeof messageField === "string" && messageField.trim().length > 0
      ? messageField
      : record["input"];

  if (typeof raw !== "string") {
    throw publicInvalidRequest("A non-empty `message` string is required.");
  }

  const message = raw.trim();

  if (message.length === 0) {
    throw publicInvalidRequest("A non-empty `message` string is required.");
  }

  if (message.length > PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH) {
    throw publicInvalidRequest(
      `\`message\` must be at most ${PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH} characters.`,
    );
  }

  return message;
}

export function parseBoundAgentCallBody(body: unknown): BoundAgentCallInput {
  return { message: readBoundAgentMessage(body) };
}

/**
 * Verify the capability token carried in the URL. Rejects (401) when the token
 * is malformed, signed with a different secret, or expired.
 */
export async function verifyBoundAgentCapability(
  secret: string,
  token: string,
  nowMs: number,
): Promise<AppAgentCapabilityClaims> {
  const verification = await inspectBoundAgentCapability(secret, token, nowMs);

  if (verification.status !== "valid") {
    throw publicUnauthenticated("The capability URL is invalid or has expired.");
  }

  return verification.claims;
}

export async function inspectBoundAgentCapability(
  secret: string,
  token: string,
  nowMs: number,
): Promise<AppAgentCapabilityTokenVerification> {
  return inspectAppAgentCapabilityToken(secret, token, nowMs);
}

/**
 * Defense in depth against a revoked binding: re-check the Agent is still
 * published (the same criterion the deploy-time resolver used) and that it
 * belongs to the App the capability was minted for.
 */
export function getBoundAgentServabilityFailure(
  agent: AgentRow,
  claims: AppAgentCapabilityClaims,
): BoundAgentServabilityFailure | null {
  if (agent.appId !== claims.appId || agent.name !== claims.binding.name) {
    return "agent_mismatched";
  }

  if (agent.status !== "published" || agent.liveDeploymentVersionId === null) {
    return "agent_unpublished";
  }

  return null;
}

export function ensureBoundAgentServable(agent: AgentRow, claims: AppAgentCapabilityClaims): void {
  if (getBoundAgentServabilityFailure(agent, claims) !== null) {
    throw publicAgentNotExposed("This Agent is no longer published for bound calls.");
  }
}

export const BOUND_AGENT_TERMINAL_RUN_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

export type BoundAgentTerminalRunStatus = (typeof BOUND_AGENT_TERMINAL_RUN_STATUSES)[number];

export function isTerminalRunStatus(
  status: SessionRunStatus,
): status is BoundAgentTerminalRunStatus {
  return (BOUND_AGENT_TERMINAL_RUN_STATUSES as readonly SessionRunStatus[]).includes(status);
}

// A run parked waiting for interactive input never reaches a terminal state on
// its own; the single-call bound ask cannot answer it, so we stop waiting and
// surface a clear error instead of letting it run out the clock.
const BOUND_AGENT_BLOCKED_RUN_STATUSES = ["waiting_input"] as const;

export function isBlockedRunStatus(status: SessionRunStatus): boolean {
  return (BOUND_AGENT_BLOCKED_RUN_STATUSES as readonly SessionRunStatus[]).includes(status);
}

export interface BoundAgentRunWaitDeps<T extends { status: SessionRunStatus }> {
  delay: (ms: number) => Promise<void>;
  now: () => number;
  readRun: () => Promise<T | null>;
}

export interface BoundAgentRunWaitOptions {
  pollIntervalMs: number;
  timeoutMs: number;
}

/**
 * Poll `readRun` until the run reaches a terminal state, then return that run.
 * Throws `boundAgentCallTimeout()` once `timeoutMs` elapses. Dependencies are
 * injected so the loop is deterministic under test.
 */
export async function waitForTerminalRun<T extends { status: SessionRunStatus }>(
  deps: BoundAgentRunWaitDeps<T>,
  options: BoundAgentRunWaitOptions,
): Promise<T> {
  const startedAt = deps.now();

  for (;;) {
    const run = await deps.readRun();

    if (run !== null && isTerminalRunStatus(run.status)) {
      return run;
    }

    if (run !== null && isBlockedRunStatus(run.status)) {
      throw boundAgentNeedsInput();
    }

    if (deps.now() - startedAt >= options.timeoutMs) {
      throw boundAgentCallTimeout();
    }

    await deps.delay(options.pollIntervalMs);
  }
}

/**
 * Resolve the reply for a terminal run from its canonical final assistant
 * message, otherwise surface a typed failure.
 */
export function selectBoundAgentReply(input: {
  finalOutput: PublicThreadFinalOutput | null;
  run: { error: RunError | null; status: SessionRunStatus };
}): { reply: string } {
  if (input.run.status !== "completed") {
    throw boundAgentRunFailed(input.run.status, input.run.error);
  }

  if (input.finalOutput === null) {
    throw boundAgentFinalOutputMissing();
  }

  return { reply: input.finalOutput.text };
}
