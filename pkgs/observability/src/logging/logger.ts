import { createLogger } from "vestig";
import type { LogEntry, LogLevel, Logger, LoggerConfig, Transport, TransportConfig } from "vestig";

import { normalizeLogContext } from "../metadata/log-metadata";

interface BaseLoggerOptions {
  context?: Record<string, unknown>;
  level?: LogLevel;
  namespace?: string;
  service: string;
}

interface BufferedSinkTransportOptions {
  flushIntervalMs?: number;
  level?: LogLevel;
  maxBatchSize?: number;
  maxBufferSize?: number;
  name?: string;
  onError?: (error: unknown, entries: readonly LogEntry[]) => void;
  sink: (entries: LogEntry[]) => Promise<void>;
}

interface BufferedSinkTransportConfig {
  flushIntervalMs: number;
  level: LogLevel;
  maxBatchSize: number;
  maxBufferSize: number;
  name: string;
  onError: (error: unknown, entries: readonly LogEntry[]) => void;
  sink: (entries: LogEntry[]) => Promise<void>;
}

interface CreateBufferedSinkLoggerOptions extends BaseLoggerOptions, BufferedSinkTransportOptions {}

const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_MAX_BATCH_SIZE = 32;
const DEFAULT_MAX_BUFFER_SIZE = 512;
const ignoreBufferedSinkError: BufferedSinkTransportConfig["onError"] = (error, entries) => {
  Object.is(error, entries);
};

class BufferedSinkTransport implements Transport {
  readonly config: TransportConfig;
  readonly name;

  #buffer: LogEntry[] = [];
  #flushPromise: Promise<void> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: BufferedSinkTransportConfig;

  constructor(options: BufferedSinkTransportConfig) {
    this.options = options;
    this.name = options.name;
    this.config = {
      level: options.level,
      name: options.name,
    };
  }

  log(entry: LogEntry): void {
    if (this.#buffer.length >= this.options.maxBufferSize) {
      this.#buffer.shift();
    }

    this.#buffer.push(entry);

    if (this.#buffer.length >= this.options.maxBatchSize) {
      void this.flush();
      return;
    }

    this.#scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.#flushPromise !== null) {
      return this.#flushPromise;
    }

    this.#clearTimer();

    if (this.#buffer.length === 0) {
      return;
    }

    this.#flushPromise = this.#flushBatchesWithCleanup();

    return this.#flushPromise;
  }

  async destroy(): Promise<void> {
    this.#clearTimer();
    await this.flush();
  }

  #scheduleFlush(): void {
    if (this.#timer !== null) {
      return;
    }

    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.options.flushIntervalMs);
  }

  #clearTimer(): void {
    if (this.#timer === null) {
      return;
    }

    clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #flushBatchesWithCleanup(): Promise<void> {
    try {
      await this.#flushBatches();
    } finally {
      this.#flushPromise = null;
    }
  }

  async #flushBatches(): Promise<void> {
    if (this.#buffer.length === 0) {
      return;
    }

    const entries = this.#buffer.splice(0, this.options.maxBatchSize);

    try {
      await this.options.sink(entries);
    } catch (error) {
      this.#buffer = [...entries, ...this.#buffer];
      this.options.onError(error, entries);
      this.#scheduleFlush();
      return;
    }

    await this.#flushBatches();
  }
}

function createBaseLogger(options: BaseLoggerOptions): Logger {
  const config: LoggerConfig = {
    context: normalizeLogContext({
      service: options.service,
      ...options.context,
    }),
    level: options.level ?? "info",
    sanitize: "default",
    structured: true,
    ...(options.namespace === undefined || options.namespace.length === 0
      ? {}
      : { namespace: options.namespace }),
  };

  return createLogger(config);
}

export function createConsoleLogger(options: BaseLoggerOptions): Logger {
  return createBaseLogger(options);
}

export function createBufferedSinkLogger(options: CreateBufferedSinkLoggerOptions): Logger {
  const logger = createBaseLogger(options);
  const level = options.level ?? "info";
  logger.removeTransport("console");

  logger.addTransport(
    new BufferedSinkTransport({
      flushIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      level,
      maxBatchSize: options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
      maxBufferSize: options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
      name: options.name ?? "buffered-sink",
      onError: options.onError ?? ignoreBufferedSinkError,
      sink: options.sink,
    }),
  );

  return logger;
}
