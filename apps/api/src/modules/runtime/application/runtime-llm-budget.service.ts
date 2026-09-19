import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type { DriverInstanceId, ProjectId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { calculateUsageCost, findModelPricing } from "../../cost/domain/cost-pricing";
import { normalizeUsageTokens } from "../../cost/domain/usage-contract";
import {
  reserveSessionRunModelRequest,
  settleSessionRunModelRequest,
  SessionRunBudgetError,
} from "../infrastructure/session-runs/session-run-budget.repository";

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// These are per-request cumulative counters, not per-SSE-event deltas.
class ModelUsageObserver {
  private input: number | null = null;
  private output: number | null = null;
  private cacheRead = 0;
  private cacheWrite = 0;
  private buffer = "";
  private data = "";
  private oversized = false;
  private invalidUsage = false;
  finished = false;

  private readonly protocol: PresetModelProtocol;
  constructor(protocol: PresetModelProtocol) {
    this.protocol = protocol;
  }

  private usage(value: unknown) {
    const usage = object(value);
    if (!usage) return;
    for (const key of [
      "input_tokens",
      "output_tokens",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
    ]) {
      if (key in usage && count(usage[key]) === null) this.invalidUsage = true;
    }
    this.input = count(usage["input_tokens"]) ?? this.input;
    this.output = count(usage["output_tokens"]) ?? this.output;
    if (this.protocol === "anthropic-messages") {
      this.cacheRead = count(usage["cache_read_input_tokens"]) ?? this.cacheRead;
      this.cacheWrite = count(usage["cache_creation_input_tokens"]) ?? this.cacheWrite;
    } else {
      const details = object(usage["input_tokens_details"]);
      if (details)
        for (const key of ["cached_tokens", "cache_write_tokens"]) {
          if (key in details && count(details[key]) === null) this.invalidUsage = true;
        }
      this.cacheRead = count(details?.["cached_tokens"]) ?? this.cacheRead;
      this.cacheWrite = count(details?.["cache_write_tokens"]) ?? this.cacheWrite;
    }
  }

  json(value: unknown, streaming: boolean) {
    const item = object(value);
    if (!item) return;
    if (!streaming) {
      this.usage(item["usage"]);
      this.finished = true;
    } else if (this.protocol === "anthropic-messages") {
      if (item["type"] === "message_start") this.usage(object(item["message"])?.["usage"]);
      if (item["type"] === "message_delta") this.usage(item["usage"]);
      if (item["type"] === "message_stop") this.finished = true;
    } else if (
      ["response.completed", "response.incomplete", "response.failed"].includes(
        String(item["type"]),
      )
    ) {
      this.usage(object(item["response"])?.["usage"]);
      this.finished = true;
    }
  }

  text(chunk: string) {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      if (!line) {
        if (!this.oversized && this.data) {
          try {
            this.json(JSON.parse(this.data), true);
          } catch {
            /* Unknown frames never establish usage. */
          }
        }
        this.data = "";
        this.oversized = false;
      } else if (line.startsWith("data:") && !this.oversized) {
        this.data += `${line.slice(5).trimStart()}\n`;
        if (this.data.length > 262_144) {
          this.oversized = true;
          this.data = "";
        }
      }
    }
    if (this.buffer.length > 262_144) {
      this.oversized = true;
      this.buffer = "";
    }
  }

  cost(input: { model: string; provider: string; pricedAtMs: number }): number | null {
    if (!this.finished || this.invalidUsage || this.input === null || this.output === null)
      return null;
    if (this.protocol !== "anthropic-messages" && this.cacheRead + this.cacheWrite > this.input)
      return null;
    const tokens = normalizeUsageTokens({
      inputTokens: this.input,
      outputTokens: this.output,
      cacheReadTokens: this.cacheRead,
      cacheCreationTokens: this.cacheWrite,
      usageContract:
        this.protocol === "anthropic-messages"
          ? "anthropic_bucketed"
          : "openai_total_with_cached_breakdown",
    });
    const cost = calculateUsageCost({
      ...input,
      ...tokens,
    });
    const micros = Math.ceil(cost.totalCostUsd * 1_000_000);
    return cost.pricingStatus === "priced" && Number.isSafeInteger(micros) ? micros : null;
  }
}

export async function executeBudgetedModelRequest(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    projectId: ProjectId;
    model: string;
    provider: string;
    protocol: PresetModelProtocol;
  },
  execute: () => Promise<Response>,
): Promise<Response> {
  const reservation = await reserveSessionRunModelRequest(bindings.DB, input);
  if (reservation === null) return execute();
  if (
    !["anthropic-messages", "openai-responses"].includes(input.protocol) ||
    findModelPricing({
      modelId: input.model,
      providerId: input.provider,
      atMs: reservation.pricedAtMs,
    }) === null
  ) {
    await settleSessionRunModelRequest(bindings.DB, reservation, null);
    throw new SessionRunBudgetError("budget_usage_unavailable", 402);
  }
  let settled = false;
  const settle = async (cost: number | null) => {
    if (settled) return;
    await settleSessionRunModelRequest(bindings.DB, reservation, cost);
    settled = true;
  };
  let response: Response;
  try {
    response = await execute();
  } catch (error) {
    await settle(null);
    throw error;
  }
  if (!response.ok) {
    await settle(response.status >= 400 && response.status < 500 ? 0 : null);
    return response;
  }
  if (!response.body) {
    await settle(null);
    return response;
  }
  const observer = new ModelUsageObserver(input.protocol);
  const cost = () => observer.cost({ ...input, pricedAtMs: reservation.pricedAtMs });
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const bytes = await response.arrayBuffer();
    try {
      observer.json(JSON.parse(new TextDecoder().decode(bytes)), false);
    } catch {
      /* Preserve the response and fail closed on unknown usage. */
    }
    await settle(cost());
    return new Response(bytes, response);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            observer.text(decoder.decode());
            await settle(cost());
            controller.close();
            return;
          }
          observer.text(decoder.decode(next.value, { stream: true }));
          // The SDK can issue its next call as soon as it sees the terminal frame.
          if (observer.finished) await settle(cost());
          controller.enqueue(next.value);
        } catch (error) {
          await settle(null);
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
        await settle(cost());
      },
    }),
    response,
  );
}
