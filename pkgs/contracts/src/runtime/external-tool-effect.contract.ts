import { type } from "arktype";

import { NonEmptyString } from "../validation/primitives.contract";
import {
  McpExecuteCommandResult,
  RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
} from "./runtime-command.contract";

declare const TextEncoder: new () => { encode(input?: string): Uint8Array };

export const MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES =
  RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES;

/** Canonical UUID generated once for one Driver-side provider invocation. */
export const ExternalToolEffectClaimToken = type(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
export type ExternalToolEffectClaimToken = typeof ExternalToolEffectClaimToken.infer;

const externalToolEffectSettlementEncoder = new TextEncoder();

export function measureMcpExternalToolEffectSettlement(settlement: unknown): number {
  return externalToolEffectSettlementEncoder.encode(JSON.stringify(settlement)).byteLength;
}

/**
 * Durable state for a write-capable call made outside the Mosoo control plane.
 *
 * An effect never transitions out of `unknown` automatically: no generic MCP
 * receipt or reconciliation protocol exists, so replay would be unsafe.
 */
export const ExternalToolEffectStatus = type('"intent" | "claimed" | "succeeded" | "unknown"');
export type ExternalToolEffectStatus = typeof ExternalToolEffectStatus.infer;

export const ExternalToolEffectAttemptStatus = type('"claimed" | "succeeded" | "unknown"');
export type ExternalToolEffectAttemptStatus = typeof ExternalToolEffectAttemptStatus.infer;

const externalToolEffectIntent = type({
  effectId: NonEmptyString,
  kind: '"intent"',
}).onUndeclaredKey("reject");
const externalToolEffectClaimed = type({
  attempt: "number.integer >= 1 & number.safe",
  effectId: NonEmptyString,
  idempotencyKey: NonEmptyString,
  kind: '"claimed"',
}).onUndeclaredKey("reject");
const externalToolEffectSucceeded = type({
  effectId: NonEmptyString,
  kind: '"succeeded"',
  result: McpExecuteCommandResult,
}).onUndeclaredKey("reject");
const externalToolEffectUnknown = type({
  effectId: NonEmptyString,
  kind: '"unknown"',
}).onUndeclaredKey("reject");

/** The ledger's canonical answer to observe, claim, and settlement RPCs. */
export const ExternalToolEffectState = externalToolEffectIntent
  .or(externalToolEffectClaimed)
  .or(externalToolEffectSucceeded)
  .or(externalToolEffectUnknown);
export type ExternalToolEffectState = typeof ExternalToolEffectState.infer;

const externalToolEffectSucceededSettlement = type({
  kind: '"succeeded"',
  "providerReceiptJson?": "string | null",
  result: McpExecuteCommandResult,
})
  .onUndeclaredKey("reject")
  .narrow((settlement, context) => {
    const byteLength = measureMcpExternalToolEffectSettlement(settlement);

    return byteLength <= MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES
      ? true
      : context.reject({
          actual: `${byteLength} UTF-8 bytes`,
          expected: `at most ${MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES} UTF-8 bytes`,
        });
  });

/** The only terminal observations a claim owner may settle. */
export const ExternalToolEffectSettlement = externalToolEffectSucceededSettlement.or(
  type({
    kind: '"unknown"',
  }).onUndeclaredKey("reject"),
);
export type ExternalToolEffectSettlement = typeof ExternalToolEffectSettlement.infer;

/** A successful claim always carries the grant required to execute once. */
export const ExternalToolEffectClaim = externalToolEffectClaimed
  .or(externalToolEffectSucceeded)
  .or(externalToolEffectUnknown);
export type ExternalToolEffectClaim = typeof ExternalToolEffectClaim.infer;
