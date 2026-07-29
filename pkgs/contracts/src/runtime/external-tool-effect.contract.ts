import { type } from "arktype";

import { NonEmptyString } from "../validation/primitives.contract";
import { McpExecuteCommandResult } from "./runtime-command.contract";

/**
 * Durable state for a write-capable call made outside the Mosoo control plane.
 *
 * An effect never transitions out of `unknown` automatically: no generic MCP
 * receipt or reconciliation protocol exists, so replay would be unsafe.
 */
export const ExternalToolEffectStatus = type('"intent" | "executing" | "succeeded" | "unknown"');
export type ExternalToolEffectStatus = typeof ExternalToolEffectStatus.infer;

export const ExternalToolEffectAttemptStatus = type('"executing" | "succeeded" | "unknown"');
export type ExternalToolEffectAttemptStatus = typeof ExternalToolEffectAttemptStatus.infer;

export const ExternalToolEffectClaim = type({
  attempt: "number >= 1",
  effectId: NonEmptyString,
  idempotencyKey: NonEmptyString,
  kind: '"execute"',
})
  .or(
    type({
      effectId: NonEmptyString,
      kind: '"completed"',
      result: McpExecuteCommandResult,
    }),
  )
  .or(
    type({
      effectId: NonEmptyString,
      kind: '"unknown"',
    }),
  );
export type ExternalToolEffectClaim = typeof ExternalToolEffectClaim.infer;
