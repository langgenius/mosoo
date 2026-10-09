import { createLogger } from "vestig";
import type { LogLevel, Logger } from "vestig";

export function createConsoleLogger(options: {
  level?: LogLevel;
  namespace: string;
  service: string;
}): Logger {
  return createLogger({
    context: { service: options.service },
    level: options.level ?? "info",
    namespace: options.namespace,
    sanitize: "default",
    structured: true,
  });
}
