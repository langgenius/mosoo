import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";

import { useAppSession } from "./session-provider";

const PRODUCT_NAME = "Mosoo";

type DocumentTitleScope = "app" | "global" | "org";

interface DocumentTitleRule {
  path: string;
  scope: DocumentTitleScope;
  title: string;
}

const DOCUMENT_TITLE_RULES: DocumentTitleRule[] = [
  { path: "/integrations/mcp/oauth-complete", scope: "app", title: "MCP authorization" },
  { path: "/app-settings/general", scope: "app", title: "App settings" },
  { path: "/app-settings/usage", scope: "app", title: "Usage" },
  { path: "/app-settings", scope: "app", title: "App settings" },
  { path: "/settings/access-tokens", scope: "global", title: "Access tokens" },
  { path: "/settings/profile", scope: "global", title: "Profile" },
  { path: "/settings", scope: "global", title: "Settings" },
  { path: "/environment/:environmentId", scope: "app", title: "Environments" },
  { path: "/environment", scope: "app", title: "Environments" },
  { path: "/integrations/skills", scope: "app", title: "Skills" },
  { path: "/integrations/mcp", scope: "app", title: "MCP servers" },
  { path: "/providers", scope: "app", title: "Providers" },
  { path: "/threads/:threadId", scope: "app", title: "Thread" },
  { path: "/threads", scope: "app", title: "Threads" },
  { path: "/agent/:agentId", scope: "app", title: "Agent" },
  { path: "/agent", scope: "app", title: "Agents" },
  { path: "/files", scope: "app", title: "Files" },
  { path: "/cli-auth", scope: "global", title: "CLI authorization" },
  { path: "/onboarding", scope: "global", title: "Onboarding" },
  { path: "/login", scope: "global", title: "Sign in" },
  { path: "/org/settings", scope: "org", title: "Org settings" },
  { path: "/apps", scope: "org", title: "Apps" },
  { path: "/", scope: "app", title: "Overview" },
];

function findDocumentTitleRule(pathname: string): DocumentTitleRule | null {
  return (
    DOCUMENT_TITLE_RULES.find((rule) => matchPath({ end: true, path: rule.path }, pathname)) ?? null
  );
}

function cleanTitlePart(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}

function joinDocumentTitle(parts: Array<string | null | undefined>): string {
  const normalizedParts = parts.flatMap((part) => {
    const cleaned = cleanTitlePart(part);
    return cleaned === null ? [] : [cleaned];
  });

  if (normalizedParts.length === 0) {
    return PRODUCT_NAME;
  }

  return [...normalizedParts, PRODUCT_NAME].join(" | ");
}

export function resolveDocumentTitle(input: {
  activeAppName: string | null;
  activeOrganizationName: string | null;
  pathname: string;
}): string {
  const rule = findDocumentTitleRule(input.pathname);

  if (rule === null) {
    return joinDocumentTitle([input.activeAppName]);
  }

  if (rule.scope === "app") {
    return joinDocumentTitle([rule.title, input.activeAppName]);
  }

  if (rule.scope === "org") {
    return joinDocumentTitle([rule.title, input.activeOrganizationName]);
  }

  return joinDocumentTitle([rule.title]);
}

export function DocumentTitle() {
  const location = useLocation();
  const { activeApp, activeOrganization } = useAppSession();
  const title = resolveDocumentTitle({
    activeAppName: activeApp?.name ?? null,
    activeOrganizationName: activeOrganization?.name ?? null,
    pathname: location.pathname,
  });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
