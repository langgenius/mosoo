export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

export function getAuthClientErrorMessage(
  error: {
    code?: string | undefined;
    error?: string | undefined;
    message?: string | undefined;
    status?: number | undefined;
  } | null,
): string {
  if (!error) {
    return "Unexpected error";
  }

  const decodedError =
    decodeAuthError(error.code) ?? decodeAuthError(error.message) ?? decodeAuthError(error.error);
  if (decodedError !== null) {
    return decodedError;
  }

  if (error.status === 404) {
    return "Google SSO is not configured.";
  }

  return error.message ?? error.error ?? "Unexpected error";
}

export function getSocialAuthErrorMessage(
  error: {
    code?: string | undefined;
    error?: string | undefined;
    message?: string | undefined;
    status?: number | undefined;
  } | null,
): string {
  return getAuthClientErrorMessage(error);
}

export function decodeAuthError(errorCode: string | null | undefined): string | null {
  if (errorCode === null || errorCode === undefined) {
    return null;
  }

  switch (errorCode.toLowerCase()) {
    case "access_denied": {
      return "Google sign-in was cancelled.";
    }
    case "provider_not_found":
    case "oauth_provider_not_found": {
      return "Google SSO is not configured.";
    }
    case "state_not_found":
    case "invalid_callback_request":
    case "invalid_state": {
      return "Google sign-in could not be resumed. Please try again.";
    }
    case "invalid_code":
    case "callback_failed": {
      return "Google sign-in failed. Please try again.";
    }
    default: {
      return null;
    }
  }
}

export function deriveNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "User";
  const normalized = localPart
    .split(/[._-]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");

  return normalized || "User";
}
