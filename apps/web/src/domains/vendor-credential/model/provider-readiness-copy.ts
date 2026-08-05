import type { AgentReadinessIssue } from "@mosoo/contracts/agent";

type Translate = (key: string, variables?: Record<string, string>) => string;

export const PROVIDER_KEY_REQUIRED_TEXT = "agent.providerKeyRequired";
export const ADD_PROVIDER_KEY_TEXT = "agent.addProviderKey";
export const RETRY_PROVIDER_CHECK_TEXT = "agent.retry";

export type ProviderReadinessAction = "add-provider-key" | "retry-provider-check";

export interface ProviderReadinessPresentation {
  action: ProviderReadinessAction;
  message: string;
  originalMessage: string;
  title: string;
}

const READINESS_CAPABILITY_PREFIX = "agent.capability.agent.readiness.";
const MODEL_NEEDS_KEY_SUFFIX = ": needs-key.";

function stripReadinessNextAction(message: string): string {
  return message.replace(/\s+Next: [^.]+\.?$/, "").trim();
}

function sanitizeProviderErrorDetail(detail: string): string {
  return detail
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_*.-]+/gu, "$1-***");
}

function stripProviderErrorPrefix(message: string): string {
  return message.startsWith("Provider error:")
    ? message.slice("Provider error:".length).trim()
    : message;
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
  const detail = sanitizeProviderErrorDetail(
    stripProviderErrorPrefix(stripReadinessNextAction(message?.trim() ?? "")),
  );
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

function isProviderKeyRequiredIssue(issue: AgentReadinessIssue, originalMessage: string): boolean {
  return (
    issue.code.includes(".provider_credential.") ||
    (issue.code.includes(".model.") && originalMessage.endsWith(MODEL_NEEDS_KEY_SUFFIX))
  );
}

function createProviderKeyRequiredPresentation(
  originalMessage: string,
): ProviderReadinessPresentation {
  return {
    action: "add-provider-key",
    message: PROVIDER_KEY_REQUIRED_TEXT,
    originalMessage,
    title: PROVIDER_KEY_REQUIRED_TEXT,
  };
}

function createProviderErrorPresentation(
  originalMessage: string,
  t: Translate,
): ProviderReadinessPresentation {
  return {
    action: "retry-provider-check",
    message: formatProviderErrorMessage(originalMessage, t),
    originalMessage,
    title: "providers.providerError",
  };
}

function getProviderReadinessPresentation(
  issue: AgentReadinessIssue,
  t: Translate,
): ProviderReadinessPresentation | null {
  const originalMessage = stripReadinessNextAction(issue.message);

  if (isProviderKeyRequiredIssue(issue, originalMessage)) {
    return createProviderKeyRequiredPresentation(originalMessage);
  }

  if (issue.code === `${READINESS_CAPABILITY_PREFIX}provider.error`) {
    return createProviderErrorPresentation(originalMessage, t);
  }

  return null;
}

export function getPrimaryProviderReadinessPresentation(
  issues: readonly AgentReadinessIssue[],
  t: Translate,
): ProviderReadinessPresentation | null {
  const errors = issues.filter((issue) => issue.severity === "error");

  for (const issue of errors) {
    const originalMessage = stripReadinessNextAction(issue.message);
    if (isProviderKeyRequiredIssue(issue, originalMessage)) {
      return createProviderKeyRequiredPresentation(originalMessage);
    }
  }

  for (const issue of errors) {
    const presentation = getProviderReadinessPresentation(issue, t);
    if (presentation !== null) {
      return presentation;
    }
  }

  return null;
}

export function formatReadinessIssueMessages(
  issues: readonly AgentReadinessIssue[],
  t: Translate,
): string[] {
  const messages = new Set<string>();

  for (const issue of issues) {
    if (issue.severity !== "error") {
      continue;
    }

    const presentation = getProviderReadinessPresentation(issue, t);
    messages.add(t(presentation?.message ?? issue.message));
  }

  return [...messages];
}

export function formatReadinessIssueMessage(
  issue: AgentReadinessIssue,
  t: Translate = (key) => key,
): string {
  return t(getProviderReadinessPresentation(issue, t)?.message ?? issue.message);
}
