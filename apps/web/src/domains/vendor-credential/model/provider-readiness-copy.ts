import type { AgentReadinessIssue } from "@mosoo/contracts/agent";

export const PROVIDER_KEY_REQUIRED_TEXT = "Provider key required";
export const ADD_PROVIDER_KEY_TEXT = "Add provider key";
export const RETRY_PROVIDER_CHECK_TEXT = "Retry";

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

function withProviderErrorPrefix(message: string): string {
  return `Provider error: ${message}`;
}

function appendProviderErrorDetail(message: string, detail: string | undefined): string {
  return detail === undefined || detail.length === 0 ? message : `${message} ${detail}`;
}

export function formatProviderErrorMessage(message: string | null | undefined): string {
  const detail = sanitizeProviderErrorDetail(
    stripProviderErrorPrefix(stripReadinessNextAction(message?.trim() ?? "")),
  );
  if (detail.length === 0) {
    return "Provider error";
  }

  const httpMatch = /^(http_(\d{3}))(?:\s*:\s*(.+))?$/u.exec(detail);

  if (httpMatch !== null) {
    const status = Number(httpMatch[2]);
    const responseDetail = httpMatch[3];

    switch (status) {
      case 400: {
        return withProviderErrorPrefix(
          appendProviderErrorDetail("The provider rejected the request (400).", responseDetail),
        );
      }
      case 401: {
        return withProviderErrorPrefix(
          appendProviderErrorDetail("API key was rejected (401).", responseDetail),
        );
      }
      case 403: {
        return withProviderErrorPrefix(
          appendProviderErrorDetail(
            "The key does not have permission for this provider or model (403).",
            responseDetail,
          ),
        );
      }
      case 404: {
        return withProviderErrorPrefix(
          appendProviderErrorDetail(
            "The provider endpoint or model route was not found (404).",
            responseDetail,
          ),
        );
      }
      case 408:
      case 504: {
        return withProviderErrorPrefix(
          appendProviderErrorDetail("The provider request timed out.", responseDetail),
        );
      }
      case 429: {
        return withProviderErrorPrefix(
          appendProviderErrorDetail(
            "The provider rate limited this request (429).",
            responseDetail,
          ),
        );
      }
      default: {
        return withProviderErrorPrefix(
          appendProviderErrorDetail(`Provider returned HTTP ${status}.`, responseDetail),
        );
      }
    }
  }

  switch (detail) {
    case "blocked_api_base": {
      return withProviderErrorPrefix(
        "Base URL points to localhost, a private IP, or includes credentials.",
      );
    }
    case "invalid_api_base": {
      return withProviderErrorPrefix("Base URL is invalid. Use a valid http(s) endpoint.");
    }
    case "missing_api_base": {
      return withProviderErrorPrefix("Base URL is required for this provider.");
    }
    case "missing_api_key": {
      return withProviderErrorPrefix("API key is required.");
    }
    case "missing_model_id": {
      return withProviderErrorPrefix("Model ID is required for this provider test.");
    }
    case "model_not_found": {
      return withProviderErrorPrefix(
        "The configured model was not found by the provider. Check the model id.",
      );
    }
    case "network_error": {
      return withProviderErrorPrefix(
        "Network request failed. Check the endpoint, proxy, or local network.",
      );
    }
    case "timeout": {
      return withProviderErrorPrefix(
        "Request timed out. Check the endpoint, proxy, or local network.",
      );
    }
    default: {
      return withProviderErrorPrefix(detail);
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

function createProviderErrorPresentation(originalMessage: string): ProviderReadinessPresentation {
  return {
    action: "retry-provider-check",
    message: formatProviderErrorMessage(originalMessage),
    originalMessage,
    title: "Provider error",
  };
}

function getProviderReadinessPresentation(
  issue: AgentReadinessIssue,
): ProviderReadinessPresentation | null {
  const originalMessage = stripReadinessNextAction(issue.message);

  if (isProviderKeyRequiredIssue(issue, originalMessage)) {
    return createProviderKeyRequiredPresentation(originalMessage);
  }

  if (issue.code === `${READINESS_CAPABILITY_PREFIX}provider.error`) {
    return createProviderErrorPresentation(originalMessage);
  }

  return null;
}

export function getPrimaryProviderReadinessPresentation(
  issues: readonly AgentReadinessIssue[],
): ProviderReadinessPresentation | null {
  const errors = issues.filter((issue) => issue.severity === "error");

  for (const issue of errors) {
    const originalMessage = stripReadinessNextAction(issue.message);
    if (isProviderKeyRequiredIssue(issue, originalMessage)) {
      return createProviderKeyRequiredPresentation(originalMessage);
    }
  }

  for (const issue of errors) {
    const presentation = getProviderReadinessPresentation(issue);
    if (presentation !== null) {
      return presentation;
    }
  }

  return null;
}

export function formatReadinessIssueMessages(issues: readonly AgentReadinessIssue[]): string[] {
  const messages = new Set<string>();

  for (const issue of issues) {
    if (issue.severity !== "error") {
      continue;
    }

    const presentation = getProviderReadinessPresentation(issue);
    messages.add(presentation?.message ?? issue.message);
  }

  return [...messages];
}

export function formatReadinessIssueMessage(issue: AgentReadinessIssue): string {
  return getProviderReadinessPresentation(issue)?.message ?? issue.message;
}
