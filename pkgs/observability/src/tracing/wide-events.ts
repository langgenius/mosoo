import { createWideEvent, getContext } from "vestig";
import type { Logger, WideEventBuilder, WideEventConfig, WideEventEndOptions } from "vestig";

export function createScopedWideEvent(config: WideEventConfig): WideEventBuilder {
  const context = {
    ...getContext(),
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
