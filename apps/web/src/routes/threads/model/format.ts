const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelativeTime(value: string): string {
  const deltaMs = new Date(value).getTime() - Date.now();
  const absMs = Math.abs(deltaMs);

  if (absMs < 60_000) {
    return "now";
  }

  if (absMs < 3_600_000) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / 60_000), "minute");
  }

  if (absMs < 86_400_000) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / 3_600_000), "hour");
  }

  return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / 86_400_000), "day");
}

export function formatShortRelative(value: string): string {
  const deltaMs = Date.now() - new Date(value).getTime();
  const absMs = Math.abs(deltaMs);

  if (absMs < 60_000) {
    return "now";
  }

  if (absMs < 3_600_000) {
    return `${Math.round(absMs / 60_000)}m`;
  }

  if (absMs < 86_400_000) {
    return `${Math.round(absMs / 3_600_000)}h`;
  }

  return `${Math.round(absMs / 86_400_000)}d`;
}

export function getMutationErrorMessage(error: unknown, defaultMessage: string): string {
  return error instanceof Error ? error.message : defaultMessage;
}

function canUseNotifications(): boolean {
  return globalThis.Notification !== undefined;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  return canUseNotifications() ? globalThis.Notification.permission : "unsupported";
}
