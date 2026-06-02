export function formatTokens(value: number | null): string {
  if (value === null) {
    return "-";
  }

  if (value >= 1000) {
    const k = value / 1000;
    return `${k.toFixed(k >= 10 ? 0 : 1)}k`;
  }

  return value.toString();
}

export function formatDuration(value: number | null): string {
  if (value === null) {
    return "-";
  }

  if (value < 1000) {
    return `${value}ms`;
  }

  const seconds = value / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

export function formatTotalDuration(value: number): string {
  if (value < 1000) {
    return `${value}ms`;
  }

  const seconds = value / 1000;
  return `${seconds.toFixed(seconds >= 100 ? 0 : 1)}s`;
}

export function formatOffset(offsetMs: number): string {
  const totalSeconds = Math.floor(offsetMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
