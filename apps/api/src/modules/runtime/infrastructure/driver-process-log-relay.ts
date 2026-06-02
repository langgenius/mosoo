import {
  createErrorLogContext,
  formatLogValue,
  logError,
  logWarn,
} from "../../../platform/cloudflare/logger";
import type { RuntimeProcessHandle } from "./sandbox-handles";

const MAX_DRIVER_LOG_TAIL_CHARS = 16_000;

function isDriverLogObject(raw: unknown): raw is { stderr?: unknown; stdout?: unknown } {
  return typeof raw === "object" && raw !== null && ("stderr" in raw || "stdout" in raw);
}

function formatDriverLogChunk(raw: unknown): string {
  return raw === null || raw === undefined ? "" : formatLogValue(raw);
}

function normalizeDriverLogTail(raw: unknown): string | null {
  const text = isDriverLogObject(raw)
    ? `${formatDriverLogChunk(raw.stderr)}${formatDriverLogChunk(raw.stdout)}`
    : formatDriverLogChunk(raw);
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= MAX_DRIVER_LOG_TAIL_CHARS) {
    return trimmed;
  }

  const truncatedChars = trimmed.length - MAX_DRIVER_LOG_TAIL_CHARS;
  return `[truncated ${String(truncatedChars)} chars]\n${trimmed.slice(-MAX_DRIVER_LOG_TAIL_CHARS)}`;
}

export async function relayDriverProcessLogs(input: {
  context?: Record<string, unknown>;
  message: string;
  process: RuntimeProcessHandle;
  severity?: "error" | "warn";
}): Promise<string | null> {
  try {
    const driverLogTail = normalizeDriverLogTail(await input.process.getLogs());

    if (driverLogTail === null) {
      return null;
    }

    const metadata = {
      ...input.context,
      driverLogTail,
      processId: input.process.id,
    };

    if (input.severity === "warn") {
      logWarn(input.message, metadata);
      return driverLogTail;
    }

    logError(input.message, metadata);
    return driverLogTail;
  } catch (error) {
    logWarn("runtime.driver.process.logs.read.failed", {
      ...input.context,
      processId: input.process.id,
      ...createErrorLogContext(error),
    });
    return null;
  }
}
