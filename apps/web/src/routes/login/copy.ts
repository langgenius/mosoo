export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "login.unexpectedError";
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
    return "login.unexpectedError";
  }

  const decodedError =
    decodeAuthError(error.code) ?? decodeAuthError(error.message) ?? decodeAuthError(error.error);
  if (decodedError !== null) {
    return decodedError;
  }

  if (error.status === 404) {
    return "login.googleNotConfigured";
  }

  return error.message ?? error.error ?? "login.unexpectedError";
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
      return "login.googleCancelled";
    }
    case "provider_not_found":
    case "oauth_provider_not_found": {
      return "login.googleNotConfigured";
    }
    case "state_not_found":
    case "invalid_callback_request":
    case "invalid_state": {
      return "login.googleResumeFailed";
    }
    case "invalid_code":
    case "callback_failed": {
      return "login.googleSignInFailed";
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
