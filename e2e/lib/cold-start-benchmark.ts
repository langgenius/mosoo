import { performance } from "node:perf_hooks";

export type BenchmarkStack = "a" | "b";
export type BenchmarkVariant = "after" | "before";
export type BenchmarkJourney = "one-shot" | "two-stage";
export type PairOrder = "ab" | "ba";

export const COLD_START_LEAD_TOLERANCE_MS = 500;
const COLD_START_EXPECTED_INTEGERS = Array.from({ length: 120 }, (_, index) => String(index + 1));
const COLD_START_EXPECTED_RANGE = COLD_START_EXPECTED_INTEGERS.join(",");

export interface RuntimeBenchmarkFixture {
  readonly agentConfigSha256: string;
  readonly agentId: string;
  readonly appId: string;
  readonly baseURL: string;
  readonly createdAt: string;
  readonly model: string;
  readonly pat: string;
  readonly providerId: string;
  readonly runtimeId: string;
}

export interface ColdStartPairPlan {
  readonly pair: number;
  readonly order: PairOrder;
  readonly phase: number;
  readonly runs: readonly [ColdStartRunPlan, ColdStartRunPlan];
}

export interface ColdStartRunPlan {
  readonly pair: number;
  readonly order: PairOrder;
  readonly phase: number;
  readonly sequence: 1 | 2;
  readonly stack: BenchmarkStack;
  readonly variant: BenchmarkVariant;
}

export interface ColdStartRunMetrics {
  readonly assistantChunkCount: number;
  readonly assistantEventCount: number;
  readonly assistantTextCharacters: number;
  readonly createAcceptedMs: number | null;
  readonly firstAssistantTextMs: number | null;
  readonly intentToFirstAssistantTextMs: number | null;
  readonly intentToSendMs: number | null;
  readonly interChunkMaxMs: number | null;
  readonly interChunkP50Ms: number | null;
  readonly interChunkP95Ms: number | null;
  readonly pauseOver250MsCount: number;
  readonly pauseOver500MsCount: number;
  readonly runCompletedMs: number | null;
  readonly sendToFirstAssistantTextMs: number | null;
  readonly streamConnectedMs: number | null;
  readonly streamFirstByteMs: number | null;
  readonly streamHandshakeMs: number | null;
  readonly usageTotalTokens: number | null;
}

export interface ColdStartRunFailure {
  readonly message: string;
  readonly stage: string;
}

export type ColdStartOutputValidationReason =
  | "integer_count"
  | "integer_sequence"
  | "nonce_occurrences"
  | "nonce_prefix"
  | "range_format";

export interface ColdStartOutputValidation {
  readonly expectedCanonicalCharacters: number;
  readonly integerCount: number;
  readonly nonceOccurrences: number;
  readonly reason: ColdStartOutputValidationReason | null;
  readonly valid: boolean;
}

export interface ColdStartRunResult extends ColdStartRunPlan {
  readonly cfColo: string | null;
  readonly cfRayCreate: string | null;
  readonly cfRaySend: string | null;
  readonly cfRayStream: string | null;
  readonly completedAt: string;
  readonly failure: ColdStartRunFailure | null;
  readonly fixture: {
    readonly agentConfigSha256: string;
    readonly agentId: string;
    readonly model: string;
    readonly providerId: string;
    readonly runtimeId: string;
  };
  readonly crossoverPhase: number;
  readonly intentAt: string;
  readonly journey: BenchmarkJourney;
  readonly metrics: ColdStartRunMetrics;
  readonly nonce: string;
  readonly output: ColdStartOutputValidation;
  readonly runId: string | null;
  readonly sentAt: string;
  readonly startedAt: string;
  readonly threadId: string | null;
  readonly workerVersionCreate: string | null;
  readonly workerVersionSend: string | null;
  readonly workerVersionStream: string | null;
}

export interface DistributionSummary {
  readonly max: number | null;
  readonly median: number | null;
  readonly n: number;
  readonly p75: number | null;
  readonly p95: number | null;
}

interface VariantSummary {
  readonly failureRate: number;
  readonly failures: number;
  readonly firstAssistantTextMs: DistributionSummary;
  readonly runCompletedMs: DistributionSummary;
  readonly runs: number;
  readonly streamFirstByteMs: DistributionSummary;
  readonly successes: number;
}

export interface ColdStartBenchmarkSummary {
  readonly after: VariantSummary;
  readonly before: VariantSummary;
  readonly gate: {
    readonly bootstrapCiExcludesZero: boolean;
    readonly failureRateNotWorse: boolean;
    readonly medianImprovementAtLeast20Percent: boolean;
    readonly minimumThirtyPairs: boolean;
    readonly p95NotWorse: boolean;
    readonly retain: boolean;
  };
  readonly pairedFirstAssistantText: {
    readonly bootstrapMedianDeltaCi95: readonly [number, number] | null;
    readonly completePairs: number;
    readonly incompletePairs: number;
    readonly medianAfterMinusBeforeMs: number | null;
    readonly medianImprovementPercent: number | null;
    readonly totalPairs: number;
  };
}

interface PublicThreadEvent {
  readonly content: string;
  readonly id: string;
  readonly tokens: number | null;
  readonly type: string;
}

interface MutableRunMetrics {
  assistantChunkCount: number;
  assistantEventCount: number;
  assistantTextCharacters: number;
  createAcceptedMs: number | null;
  firstAssistantTextMs: number | null;
  intentToFirstAssistantTextMs: number | null;
  intentToSendMs: number | null;
  interChunkMaxMs: number | null;
  interChunkP50Ms: number | null;
  interChunkP95Ms: number | null;
  pauseOver250MsCount: number;
  pauseOver500MsCount: number;
  runCompletedMs: number | null;
  sendToFirstAssistantTextMs: number | null;
  streamConnectedMs: number | null;
  streamFirstByteMs: number | null;
  streamHandshakeMs: number | null;
  usageTotalTokens: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Runtime benchmark fixture requires ${field}.`);
  }

  return value.trim();
}

export function parseRuntimeBenchmarkFixture(value: unknown): RuntimeBenchmarkFixture {
  if (!isRecord(value)) {
    throw new Error("Runtime benchmark fixture must be a JSON object.");
  }

  const baseURL = requireString(value, "baseURL").replace(/\/+$/u, "");
  const url = new URL(baseURL);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Runtime benchmark fixture baseURL must use HTTP or HTTPS.");
  }

  return {
    agentConfigSha256: requireString(value, "agentConfigSha256"),
    agentId: requireString(value, "agentId"),
    appId: requireString(value, "appId"),
    baseURL,
    createdAt: requireString(value, "createdAt"),
    model: requireString(value, "model"),
    pat: requireString(value, "pat"),
    providerId: requireString(value, "providerId"),
    runtimeId: requireString(value, "runtimeId"),
  };
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let state = hashSeed(seed);

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createBalancedPairOrders(totalPairs: number, seed: string): PairOrder[] {
  if (!Number.isInteger(totalPairs) || totalPairs < 2 || totalPairs % 2 !== 0) {
    throw new Error("Cold-start benchmark totalPairs must be a positive even integer.");
  }

  const orders: PairOrder[] = Array.from({ length: totalPairs }, (_, index) =>
    index < totalPairs / 2 ? "ab" : "ba",
  );
  const random = createRandom(seed);

  for (let index = orders.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = orders[index];
    const swap = orders[swapIndex];

    if (current === undefined || swap === undefined) {
      throw new Error("Cold-start benchmark order generation failed.");
    }

    orders[index] = swap;
    orders[swapIndex] = current;
  }

  return orders;
}

export function createColdStartPairPlans(input: {
  readonly pairCount: number;
  readonly pairStart: number;
  readonly phase: number;
  readonly seed: string;
  readonly stackVariants: Readonly<Record<BenchmarkStack, BenchmarkVariant>>;
  readonly totalPairs: number;
}): ColdStartPairPlan[] {
  if (
    !Number.isInteger(input.pairStart) ||
    !Number.isInteger(input.pairCount) ||
    input.pairStart < 0 ||
    input.pairCount < 1 ||
    input.pairStart + input.pairCount > input.totalPairs
  ) {
    throw new Error("Cold-start benchmark pair slice is outside totalPairs.");
  }

  const orders = createBalancedPairOrders(input.totalPairs, input.seed);

  return orders
    .slice(input.pairStart, input.pairStart + input.pairCount)
    .map((order, relativeIndex) => {
      const pair = input.pairStart + relativeIndex + 1;
      const stacks: readonly [BenchmarkStack, BenchmarkStack] =
        order === "ab" ? ["a", "b"] : ["b", "a"];
      const firstStack = stacks[0];
      const secondStack = stacks[1];

      return {
        order,
        pair,
        phase: input.phase,
        runs: [
          {
            order,
            pair,
            phase: input.phase,
            sequence: 1,
            stack: firstStack,
            variant: input.stackVariants[firstStack],
          },
          {
            order,
            pair,
            phase: input.phase,
            sequence: 2,
            stack: secondStack,
            variant: input.stackVariants[secondStack],
          },
        ],
      };
    });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function elapsed(startedAt: number): number {
  return round(performance.now() - startedAt);
}

function percentile(values: readonly number[], percentage: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1),
  );

  const value = sorted[index];
  return value === undefined ? null : round(value);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];

  if (upper === undefined) {
    return null;
  }

  if (sorted.length % 2 === 1) {
    return round(upper);
  }

  const lower = sorted[middle - 1];
  return lower === undefined ? null : round((lower + upper) / 2);
}

function summarizeDistribution(values: readonly number[]): DistributionSummary {
  return {
    max: values.length === 0 ? null : round(Math.max(...values)),
    median: median(values),
    n: values.length,
    p75: percentile(values, 75),
    p95: percentile(values, 95),
  };
}

function readPublicThreadEvent(block: string): PublicThreadEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/u)) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trimStart();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (eventName === "thread.error") {
    throw new Error("Public API event stream emitted thread.error.");
  }

  if (eventName !== "thread.event" || dataLines.length === 0) {
    return null;
  }

  const payload: unknown = JSON.parse(dataLines.join("\n"));

  if (!isRecord(payload)) {
    throw new Error("Public API event stream emitted a non-object event.");
  }

  const content = payload["content"];
  const id = payload["id"];
  const type = payload["type"];

  if (typeof content !== "string" || typeof id !== "string" || typeof type !== "string") {
    throw new Error("Public API event stream emitted an invalid thread event.");
  }

  return {
    content,
    id,
    tokens: typeof payload["tokens"] === "number" ? payload["tokens"] : null,
    type,
  };
}

function readCreatedThread(value: unknown): { readonly runId: string; readonly threadId: string } {
  if (!isRecord(value) || !isRecord(value["thread"]) || !isRecord(value["run"])) {
    throw new Error("Public API create thread response did not include thread and run.");
  }

  return {
    runId: requireString(value["run"], "id"),
    threadId: requireString(value["thread"], "id"),
  };
}

function readEmptyThread(value: unknown): string {
  if (!isRecord(value) || !isRecord(value["thread"])) {
    throw new Error("Public API create thread response did not include a thread.");
  }
  return requireString(value["thread"], "id");
}

function readSentRun(value: unknown): string {
  const events = isRecord(value) && Array.isArray(value["events"]) ? value["events"] : [];
  const event = events[0];
  if (!isRecord(event) || !isRecord(event["run"])) {
    throw new Error("Public API send events response did not include a run.");
  }
  return requireString(event["run"], "id");
}

async function requireJsonResponse(response: Response, action: string): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`${action} failed with HTTP ${response.status}.`);
  }

  return payload;
}

function readCfColo(cfRay: string | null): string | null {
  if (cfRay === null) {
    return null;
  }

  return /-([A-Z]{3})$/u.exec(cfRay)?.[1] ?? null;
}

function toFailureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "Run exceeded its timeout." : error.message.slice(0, 500);
  }

  return String(error).slice(0, 500);
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let offset = 0;

  for (;;) {
    const index = text.indexOf(needle, offset);

    if (index === -1) {
      return count;
    }

    count += 1;
    offset = index + needle.length;
  }
}

export function validateColdStartOutput(text: string, nonce: string): ColdStartOutputValidation {
  const normalizedText = text.normalize("NFKC").trim();
  const normalizedNonce = nonce.normalize("NFKC");
  const expectedCanonicalCharacters = `${normalizedNonce}. ${COLD_START_EXPECTED_RANGE}`.length;
  const nonceOccurrences = countOccurrences(normalizedText, normalizedNonce);
  const base = {
    expectedCanonicalCharacters,
    nonceOccurrences,
  };

  if (nonceOccurrences !== 1) {
    return {
      ...base,
      integerCount: 0,
      reason: "nonce_occurrences",
      valid: false,
    };
  }

  if (!normalizedText.startsWith(normalizedNonce)) {
    return {
      ...base,
      integerCount: 0,
      reason: "nonce_prefix",
      valid: false,
    };
  }

  let rangeText = normalizedText.slice(normalizedNonce.length).trim();

  if (rangeText.startsWith(".") || rangeText.startsWith(":")) {
    rangeText = rangeText.slice(1).trim();
  }

  if (rangeText.endsWith(".")) {
    rangeText = rangeText.slice(0, -1).trim();
  }

  if (rangeText.length === 0) {
    return {
      ...base,
      integerCount: 0,
      reason: "integer_count",
      valid: false,
    };
  }

  const tokens = rangeText.split(",").map((token) => token.trim());
  const integerCount = tokens.filter((token) => /^\d+$/u.test(token)).length;

  if (integerCount !== tokens.length) {
    return {
      ...base,
      integerCount,
      reason: "range_format",
      valid: false,
    };
  }

  if (tokens.length !== COLD_START_EXPECTED_INTEGERS.length) {
    return {
      ...base,
      integerCount,
      reason: "integer_count",
      valid: false,
    };
  }

  if (tokens.some((token, index) => token !== COLD_START_EXPECTED_INTEGERS[index])) {
    return {
      ...base,
      integerCount,
      reason: "integer_sequence",
      valid: false,
    };
  }

  return {
    ...base,
    integerCount,
    reason: null,
    valid: true,
  };
}

function createEmptyMetrics(): MutableRunMetrics {
  return {
    assistantChunkCount: 0,
    assistantEventCount: 0,
    assistantTextCharacters: 0,
    createAcceptedMs: null,
    firstAssistantTextMs: null,
    intentToFirstAssistantTextMs: null,
    intentToSendMs: null,
    interChunkMaxMs: null,
    interChunkP50Ms: null,
    interChunkP95Ms: null,
    pauseOver250MsCount: 0,
    pauseOver500MsCount: 0,
    runCompletedMs: null,
    sendToFirstAssistantTextMs: null,
    streamConnectedMs: null,
    streamFirstByteMs: null,
    streamHandshakeMs: null,
    usageTotalTokens: null,
  };
}

function finishCadenceMetrics(
  metrics: MutableRunMetrics,
  assistantChunkTimestamps: readonly number[],
): void {
  const gaps = assistantChunkTimestamps
    .slice(1)
    .map((timestamp, index) => timestamp - (assistantChunkTimestamps[index] ?? timestamp));

  metrics.interChunkMaxMs = gaps.length === 0 ? null : round(Math.max(...gaps));
  metrics.interChunkP50Ms = percentile(gaps, 50);
  metrics.interChunkP95Ms = percentile(gaps, 95);
  metrics.pauseOver250MsCount = gaps.filter((gap) => gap > 250).length;
  metrics.pauseOver500MsCount = gaps.filter((gap) => gap > 500).length;
}

export async function runColdStartSample(input: {
  readonly fixture: RuntimeBenchmarkFixture;
  readonly journey?: BenchmarkJourney;
  readonly leadMs?: number;
  readonly leadToleranceMs?: number;
  readonly nonce: string;
  readonly onFirstAssistantText?: (observation: {
    readonly observedAt: string;
    readonly runId: string;
    readonly threadId: string;
    readonly workerVersionCreate: string | null;
    readonly workerVersionSend: string | null;
    readonly workerVersionStream: string | null;
  }) => void;
  readonly plan: ColdStartRunPlan;
  readonly timeoutMs: number;
}): Promise<ColdStartRunResult> {
  const startedAtIso = new Date().toISOString();
  const startedAt = performance.now();
  const journey = input.journey ?? "one-shot";
  const leadMs = input.leadMs ?? 10_000;
  const leadToleranceMs = input.leadToleranceMs ?? COLD_START_LEAD_TOLERANCE_MS;
  if (!Number.isFinite(leadToleranceMs) || leadToleranceMs < 0) {
    throw new Error("Cold-start lead tolerance must be a non-negative number.");
  }
  const metrics = createEmptyMetrics();
  if (journey === "one-shot") {
    metrics.intentToSendMs = 0;
  }
  const assistantChunkTimestamps: number[] = [];
  const seenEventIds = new Set<string>();
  const controller = new AbortController();
  const deadlineAt = performance.now() + input.timeoutMs;
  const timeoutError = new Error(`Cold-start sample timed out after ${input.timeoutMs}ms.`);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
  }, input.timeoutMs);
  let assistantText = "";
  let cfRayCreate: string | null = null;
  let cfRaySend: string | null = null;
  let cfRayStream: string | null = null;
  let failure: ColdStartRunFailure | null = null;
  let output = validateColdStartOutput("", input.nonce);
  let runId: string | null = null;
  let sentAt = startedAt;
  let sentAtIso = startedAtIso;
  let stage = "create_thread";
  let threadId: string | null = null;
  let leadTimingError: Error | null = null;
  let firstAssistantObservedAt: string | null = null;
  let firstAssistantNotified = false;
  let workerVersionCreate: string | null = null;
  let workerVersionSend: string | null = null;
  let workerVersionStream: string | null = null;

  try {
    const expectedOutput = `${input.nonce}. ${COLD_START_EXPECTED_RANGE}`;
    const prompt = [
      "Copy the next line exactly as your entire response.",
      "Do not add quotes, Markdown, a prefix, a suffix, or an explanation.",
      expectedOutput,
    ].join("\n");
    const createResponse = await fetch(
      `${input.fixture.baseURL}/api/v1/agents/${encodeURIComponent(input.fixture.agentId)}/threads`,
      {
        body: JSON.stringify(
          journey === "two-stage"
            ? {}
            : {
                input: {
                  content: [{ text: prompt, type: "text" }],
                  type: "user.message",
                },
              },
        ),
        headers: {
          Authorization: `Bearer ${input.fixture.pat}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `cold-start-${input.plan.pair}-${input.plan.sequence}-${input.nonce}`,
        },
        method: "POST",
        signal: controller.signal,
      },
    );
    cfRayCreate = createResponse.headers.get("cf-ray");
    workerVersionCreate = createResponse.headers.get("x-mosoo-worker-version");
    const created = await requireJsonResponse(createResponse, "Public API create thread");
    if (journey === "two-stage") {
      threadId = readEmptyThread(created);
    } else {
      const createdThread = readCreatedThread(created);
      runId = createdThread.runId;
      threadId = createdThread.threadId;
    }
    metrics.createAcceptedMs = elapsed(startedAt);

    stage = "connect_stream";
    const streamStartedAt = performance.now();
    const streamResponse = await fetch(
      `${input.fixture.baseURL}/api/v1/threads/${encodeURIComponent(threadId)}/events/stream?limit=100`,
      {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${input.fixture.pat}`,
        },
        signal: controller.signal,
      },
    );
    cfRayStream = streamResponse.headers.get("cf-ray");
    workerVersionStream = streamResponse.headers.get("x-mosoo-worker-version");

    if (!streamResponse.ok) {
      throw new Error(`Public API stream failed with HTTP ${streamResponse.status}.`);
    }

    metrics.streamConnectedMs = elapsed(startedAt);
    metrics.streamHandshakeMs = round(performance.now() - streamStartedAt);
    const reader = streamResponse.body?.getReader();

    if (reader === undefined) {
      throw new Error("Public API event stream did not include a readable body.");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    const notifyFirstAssistantText = () => {
      if (
        firstAssistantNotified ||
        firstAssistantObservedAt === null ||
        runId === null ||
        threadId === null
      ) {
        return;
      }
      firstAssistantNotified = true;
      input.onFirstAssistantText?.({
        observedAt: firstAssistantObservedAt,
        runId,
        threadId,
        workerVersionCreate,
        workerVersionSend,
        workerVersionStream,
      });
    };
    const consumeStream = async () => {
      try {
        while (metrics.runCompletedMs === null) {
          const remainingMs = Math.max(0, deadlineAt - performance.now());
          let readTimeout: ReturnType<typeof setTimeout> | null = null;
          const chunk = await Promise.race([
            reader.read(),
            new Promise<never>((_resolve, reject) => {
              readTimeout = setTimeout(() => {
                timedOut = true;
                controller.abort(timeoutError);
                reject(timeoutError);
              }, remainingMs);
            }),
          ]).finally(() => {
            if (readTimeout !== null) {
              clearTimeout(readTimeout);
            }
          });

          if (chunk.done) {
            throw new Error("Public API event stream closed before run.completed.");
          }

          const chunkObservedAt = performance.now();
          const eventElapsedMs = round(chunkObservedAt - startedAt);
          metrics.streamFirstByteMs ??= eventElapsedMs;
          buffer += decoder.decode(chunk.value, { stream: true });
          let chunkHadVisibleAssistantText = false;

          for (;;) {
            const separator = /\r?\n\r?\n/u.exec(buffer);

            if (separator === null) {
              break;
            }

            const block = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);
            const event = readPublicThreadEvent(block);

            if (event === null || seenEventIds.has(event.id)) {
              continue;
            }

            seenEventIds.add(event.id);

            if (event.tokens !== null) {
              metrics.usageTotalTokens = Math.max(metrics.usageTotalTokens ?? 0, event.tokens);
            }

            if (event.type === "run.failed") {
              throw new Error(`Public API run emitted run.failed: ${event.content}`);
            }

            if (event.type === "run.completed") {
              metrics.runCompletedMs = eventElapsedMs;
              continue;
            }

            if (!event.type.startsWith("agent.message")) {
              continue;
            }

            if (event.content.trim().length > 0) {
              if (metrics.firstAssistantTextMs === null) {
                metrics.firstAssistantTextMs = eventElapsedMs;
                metrics.intentToFirstAssistantTextMs = eventElapsedMs;
                metrics.sendToFirstAssistantTextMs = round(chunkObservedAt - sentAt);
                firstAssistantObservedAt = new Date().toISOString();
                notifyFirstAssistantText();
              }
              metrics.assistantEventCount += 1;
              chunkHadVisibleAssistantText = true;
            }

            if (event.type.endsWith(".completed") && event.content.length > assistantText.length) {
              assistantText = event.content;
            } else {
              assistantText += event.content;
            }
          }

          // Cadence is a user-visible transport property. Multiple SSE frames
          // delivered by one reader.read() are one burst, not zero-gap streaming.
          if (chunkHadVisibleAssistantText) {
            metrics.assistantChunkCount += 1;
            assistantChunkTimestamps.push(chunkObservedAt);
          }
        }
      } finally {
        await Promise.race([reader.cancel().catch(() => {}), Bun.sleep(1_000)]);
      }
    };
    const streamResult = consumeStream().then(
      () => null,
      (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    );
    if (journey === "two-stage") {
      stage = "wait_until_send";
      await Bun.sleep(Math.max(0, startedAt + leadMs - performance.now()));
      sentAt = performance.now();
      sentAtIso = new Date().toISOString();
      metrics.intentToSendMs = round(sentAt - startedAt);
      const leadDriftMs = Math.abs(metrics.intentToSendMs - leadMs);
      if (leadDriftMs > leadToleranceMs) {
        leadTimingError = new Error(
          `Two-stage send missed its lead window by ${round(leadDriftMs)}ms (allowed ${leadToleranceMs}ms).`,
        );
      }
      stage = "send_events";
      const sendResponse = await fetch(
        `${input.fixture.baseURL}/api/v1/threads/${encodeURIComponent(threadId)}/events`,
        {
          body: JSON.stringify({
            events: [
              {
                clientRequestId: `cold-start-${input.plan.pair}-${input.plan.sequence}`,
                text: prompt,
                type: "user_message",
              },
            ],
          }),
          headers: {
            Authorization: `Bearer ${input.fixture.pat}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `cold-start-send-${input.plan.pair}-${input.plan.sequence}-${input.nonce}`,
          },
          method: "POST",
          signal: controller.signal,
        },
      );
      cfRaySend = sendResponse.headers.get("cf-ray");
      workerVersionSend = sendResponse.headers.get("x-mosoo-worker-version");
      runId = readSentRun(await requireJsonResponse(sendResponse, "Public API send events"));
      notifyFirstAssistantText();
    }
    stage = "read_stream";
    const streamError = await streamResult;
    if (streamError !== null) {
      throw streamError;
    }

    stage = "validate_output";

    if (metrics.firstAssistantTextMs === null) {
      throw new Error("Run completed without visible assistant text.");
    }

    output = validateColdStartOutput(assistantText, input.nonce);

    if (!output.valid) {
      throw new Error(`Assistant output failed semantic validation: ${output.reason}.`);
    }
    if (leadTimingError !== null) {
      stage = "validate_lead";
      throw leadTimingError;
    }
  } catch (error) {
    failure = {
      message: timedOut ? timeoutError.message : toFailureMessage(error),
      stage,
    };
  } finally {
    controller.abort();
    clearTimeout(timeout);
    metrics.assistantTextCharacters = assistantText.length;
    output = validateColdStartOutput(assistantText, input.nonce);
    finishCadenceMetrics(metrics, assistantChunkTimestamps);
  }

  return {
    ...input.plan,
    cfColo: readCfColo(cfRayStream ?? cfRaySend ?? cfRayCreate),
    cfRayCreate,
    cfRaySend,
    cfRayStream,
    completedAt: new Date().toISOString(),
    failure,
    fixture: {
      agentConfigSha256: input.fixture.agentConfigSha256,
      agentId: input.fixture.agentId,
      model: input.fixture.model,
      providerId: input.fixture.providerId,
      runtimeId: input.fixture.runtimeId,
    },
    metrics,
    nonce: input.nonce,
    output,
    crossoverPhase: input.plan.phase,
    intentAt: startedAtIso,
    journey,
    runId,
    sentAt: sentAtIso,
    startedAt: startedAtIso,
    threadId,
    workerVersionCreate,
    workerVersionSend,
    workerVersionStream,
  };
}

function summarizeVariant(
  runs: readonly ColdStartRunResult[],
  variant: BenchmarkVariant,
): VariantSummary {
  const selected = runs.filter((run) => run.variant === variant);
  const successful = selected.filter((run) => run.failure === null);
  const pickMetric = (field: "firstAssistantTextMs" | "runCompletedMs" | "streamFirstByteMs") =>
    successful.flatMap((run) => {
      const value = run.metrics[field];
      return value === null ? [] : [value];
    });
  const failures = selected.length - successful.length;

  return {
    failureRate:
      selected.length === 0 ? 0 : Math.round((failures / selected.length) * 10_000) / 10_000,
    failures,
    firstAssistantTextMs: summarizeDistribution(pickMetric("firstAssistantTextMs")),
    runCompletedMs: summarizeDistribution(pickMetric("runCompletedMs")),
    runs: selected.length,
    streamFirstByteMs: summarizeDistribution(pickMetric("streamFirstByteMs")),
    successes: successful.length,
  };
}

function bootstrapMedianDeltaCi95(
  values: readonly number[],
  seed: string,
): [number, number] | null {
  if (values.length === 0) {
    return null;
  }

  const random = createRandom(seed);
  const medians: number[] = [];

  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const sample = Array.from(
      { length: values.length },
      () => values[Math.floor(random() * values.length)] ?? 0,
    );
    medians.push(median(sample) ?? 0);
  }

  return [percentile(medians, 2.5) ?? 0, percentile(medians, 97.5) ?? 0];
}

export function summarizeColdStartBenchmark(
  runs: readonly ColdStartRunResult[],
  seed: string,
): ColdStartBenchmarkSummary {
  const before = summarizeVariant(runs, "before");
  const after = summarizeVariant(runs, "after");
  const byPair = new Map<number, ColdStartRunResult[]>();

  for (const run of runs) {
    const entries = byPair.get(run.pair) ?? [];
    entries.push(run);
    byPair.set(run.pair, entries);
  }

  const deltas: number[] = [];
  const improvements: number[] = [];

  for (const entries of byPair.values()) {
    const beforeRun = entries.find((run) => run.variant === "before" && run.failure === null);
    const afterRun = entries.find((run) => run.variant === "after" && run.failure === null);
    const beforeMs = beforeRun?.metrics.firstAssistantTextMs ?? null;
    const afterMs = afterRun?.metrics.firstAssistantTextMs ?? null;

    if (beforeMs === null || afterMs === null) {
      continue;
    }

    deltas.push(afterMs - beforeMs);
    improvements.push(((beforeMs - afterMs) / beforeMs) * 100);
  }

  const ci = bootstrapMedianDeltaCi95(deltas, `${seed}:paired-bootstrap`);
  const medianImprovementPercent = median(improvements);
  const medianDelta = median(deltas);
  const minimumThirtyPairs = byPair.size >= 30 && deltas.length >= 30;
  const medianImprovementAtLeast20Percent = (medianImprovementPercent ?? -Infinity) >= 20;
  const bootstrapCiExcludesZero = ci !== null && ci[1] < 0;
  const p95NotWorse =
    after.firstAssistantTextMs.p95 !== null &&
    before.firstAssistantTextMs.p95 !== null &&
    after.firstAssistantTextMs.p95 <= before.firstAssistantTextMs.p95;
  const failureRateNotWorse = after.failures * before.runs <= before.failures * after.runs;

  return {
    after,
    before,
    gate: {
      bootstrapCiExcludesZero,
      failureRateNotWorse,
      medianImprovementAtLeast20Percent,
      minimumThirtyPairs,
      p95NotWorse,
      retain: minimumThirtyPairs && bootstrapCiExcludesZero && p95NotWorse && failureRateNotWorse,
    },
    pairedFirstAssistantText: {
      bootstrapMedianDeltaCi95: ci,
      completePairs: deltas.length,
      incompletePairs: byPair.size - deltas.length,
      medianAfterMinusBeforeMs: medianDelta === null ? null : round(medianDelta),
      medianImprovementPercent:
        medianImprovementPercent === null ? null : round(medianImprovementPercent),
      totalPairs: byPair.size,
    },
  };
}
