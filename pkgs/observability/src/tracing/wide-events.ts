import { createWideEvent } from "vestig";
import type { Logger, WideEventBuilder, WideEventConfig, WideEventEndOptions } from "vestig";

import { getActiveLogContext } from "./log-context";

export function createScopedWideEvent(config: WideEventConfig): WideEventBuilder {
  const activeContext = getActiveLogContext();
  const context = {
    ...activeContext,
    ...config.context,
  };

  return createWideEvent({
    type: config.type,
    ...(config.fields ? { fields: config.fields } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
  });
}

export function emitWideEvent(
  logger: Logger,
  builder: WideEventBuilder,
  options?: WideEventEndOptions,
): void {
  logger.emitWideEvent(builder.end(options));
}
