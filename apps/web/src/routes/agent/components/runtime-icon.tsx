import type { CSSProperties, ReactElement } from "react";

import {
  RuntimeIcon as BrandRuntimeIcon,
  hasRuntimeIcon,
} from "@/shared/ui/brand-icons/runtime-icon";

import type { RuntimeInfo } from "../agent.types";

function runtimeIconFrameStyle(size: number, radius: number): CSSProperties {
  return { borderRadius: radius, height: size, width: size };
}

function runtimeIconFallbackStyle(
  runtime: RuntimeInfo,
  iconSize: number,
  size: number,
): CSSProperties {
  return {
    color: runtime.color,
    fontSize: `${size * 0.34}px`,
    height: iconSize,
    width: iconSize,
  };
}

export function RuntimeIcon({
  runtime,
  size = 32,
}: {
  runtime: RuntimeInfo;
  size?: number;
}): ReactElement {
  const radius = size <= 30 ? 8 : 10;
  const iconSize = size * 0.75;

  return (
    <div
      className="bg-card flex shrink-0 items-center justify-center overflow-hidden"
      style={runtimeIconFrameStyle(size, radius)}
    >
      {hasRuntimeIcon(runtime.id) ? (
        <BrandRuntimeIcon className="size-full shrink-0" runtimeId={runtime.id} />
      ) : (
        <span
          className="inline-flex items-center justify-center font-extrabold tracking-[0.02em]"
          style={runtimeIconFallbackStyle(runtime, iconSize, size)}
        >
          {runtime.icon}
        </span>
      )}
    </div>
  );
}
