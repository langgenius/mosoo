import type { AgentReadinessIssue } from "@mosoo/contracts/agent";

type Translate = (key: string, variables?: Record<string, string>) => string;

export const PROVIDER_KEY_REQUIRED_TEXT = "agent.providerKeyRequired";
export const ADD_PROVIDER_KEY_TEXT = "agent.addProviderKey";

const MODEL_NEEDS_KEY_SUFFIX = ": needs-key.";

function sanitizeProviderErrorDetail(detail: string): string {
  return detail.trim().replace(/\s+/gu, " ");
}

function withProviderErrorPrefix(t: Translate, message: string): string {
  return `${t("providers.providerErrorPrefix")}${message}`;
}

function detailInterpolation(detail: string | undefined): string {
  return detail === undefined || detail.length === 0 ? "" : ` ${detail}`;
}

export function formatProviderErrorMessage(
  message: string | null | undefined,
  t: Translate,
): string {
  const detail = sanitizeProviderErrorDetail(message ?? "");
  if (detail.length === 0) {
    return t("providers.providerError");
  }

  const httpMatch = /^(http_(\d{3}))(?:\s*:\s*(.+))?$/u.exec(detail);

  if (httpMatch !== null) {
    const status = Number(httpMatch[2]);
    const responseDetail = httpMatch[3];
    const responseValue = detailInterpolation(responseDetail);

    switch (status) {
      case 400: {
        return withProviderErrorPrefix(
          t,
          t("providers.credentialError.status400", { detail: responseValue }),
        );
      }
      case 401: {
        return withProviderErrorPrefix(
          t,
          t("providers.credentialError.status401", { detail: responseValue }),
        );
      }
      case 403: {
        return withProviderErrorPrefix(
          t,
          t("providers.credentialError.status403", { detail: responseValue }),
        );
      }
      case 404: {
        return withProviderErrorPrefix(
          t,
          t("providers.credentialError.status404", { detail: responseValue }),
        );
      }
      case 408:
      case 504: {
        return withProviderErrorPrefix(
          t,
          t("providers.credentialError.statusTimeout", { detail: responseValue }),
        );
      }
      case 429: {
        return withProviderErrorPrefix(
          t,
          t("providers.credentialError.status429", { detail: responseValue }),
        );
      }
      default: {
        return withProviderErrorPrefix(
          t,
          t("providers.credentialError.httpStatus", {
            detail: responseValue,
            status: String(status),
          }),
        );
      }
    }
  }

  switch (detail) {
    case "blocked_api_base": {
      return withProviderErrorPrefix(t, t("providers.credentialError.blockedApiBase"));
    }
    case "invalid_api_base": {
      return withProviderErrorPrefix(t, t("providers.credentialError.invalidApiBase"));
    }
    case "missing_api_base": {
      return withProviderErrorPrefix(t, t("providers.credentialError.missingApiBase"));
    }
    case "missing_api_key": {
      return withProviderErrorPrefix(t, t("providers.credentialError.missingApiKey"));
    }
    case "missing_model_id": {
      return withProviderErrorPrefix(t, t("providers.credentialError.missingModelId"));
    }
    case "model_not_found": {
      return withProviderErrorPrefix(t, t("providers.credentialError.modelNotFound"));
    }
    case "network_error": {
      return withProviderErrorPrefix(t, t("providers.credentialError.networkError"));
    }
    case "timeout": {
      return withProviderErrorPrefix(t, t("providers.credentialError.timeout"));
    }
    default: {
      return withProviderErrorPrefix(t, detail);
    }
  }
}

function isProviderKeyRequiredIssue(issue: AgentReadinessIssue): boolean {
  return (
    issue.code.includes(".provider_credential.") ||
    (issue.code.includes(".model.") && issue.message.endsWith(MODEL_NEEDS_KEY_SUFFIX))
  );
}

export function isProviderKeyRequired(issues: readonly AgentReadinessIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error" && isProviderKeyRequiredIssue(issue));
}

export function formatReadinessIssueMessage(issue: AgentReadinessIssue, t: Translate): string {
  return t(isProviderKeyRequiredIssue(issue) ? PROVIDER_KEY_REQUIRED_TEXT : issue.message);
}
