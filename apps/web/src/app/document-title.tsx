import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";

import { useAppSession } from "./session-provider";

const PRODUCT_NAME = "mosoo";
const DEFAULT_TITLE_TRANSLATIONS: Record<string, string> = {
  "pageTitle.apps": "Apps",
  "pageTitle.mcpAuth": "MCP authorization",
  "pageTitle.appSettings": "App settings",
  "pageTitle.usage": "Usage",
  "pageTitle.accessTokens": "Access tokens",
  "pageTitle.profile": "Profile",
  "pageTitle.settings": "Settings",
  "pageTitle.environments": "Environments",
  "pageTitle.skills": "Skills",
  "pageTitle.mcpServers": "MCP servers",
  "pageTitle.providers": "Providers",
  "pageTitle.thread": "Thread",
  "pageTitle.threads": "Threads",
  "pageTitle.agent": "Agent",
  "pageTitle.agents": "Agents",
  "pageTitle.files": "Files",
  "pageTitle.cliAuth": "CLI authorization",
  "pageTitle.deploymentPreview": "Deployment preview",
  "pageTitle.onboarding": "Onboarding",
  "pageTitle.signIn": "Sign in",
  "pageTitle.orgSettings": "Org settings",
  "pageTitle.overview": "Overview",
};

type DocumentTitleScope = "app" | "global" | "org";

interface DocumentTitleRule {
  path: string;
  scope: DocumentTitleScope;
  titleKey: string;
}

const DOCUMENT_TITLE_RULES: DocumentTitleRule[] = [
  { path: "/integrations/mcp/oauth-complete", scope: "app", titleKey: "pageTitle.mcpAuth" },
  { path: "/app-settings/general", scope: "app", titleKey: "pageTitle.appSettings" },
  { path: "/app-settings/usage", scope: "app", titleKey: "pageTitle.usage" },
  { path: "/app-settings", scope: "app", titleKey: "pageTitle.appSettings" },
  { path: "/settings/access-tokens", scope: "global", titleKey: "pageTitle.accessTokens" },
  { path: "/settings/profile", scope: "global", titleKey: "pageTitle.profile" },
  { path: "/settings", scope: "global", titleKey: "pageTitle.settings" },
  { path: "/environment/:environmentId", scope: "app", titleKey: "pageTitle.environments" },
  { path: "/environment", scope: "app", titleKey: "pageTitle.environments" },
  { path: "/integrations/skills", scope: "app", titleKey: "pageTitle.skills" },
  { path: "/integrations/mcp", scope: "app", titleKey: "pageTitle.mcpServers" },
  { path: "/providers", scope: "app", titleKey: "pageTitle.providers" },
  { path: "/threads/:threadId", scope: "app", titleKey: "pageTitle.thread" },
  { path: "/threads", scope: "app", titleKey: "pageTitle.threads" },
  { path: "/agent/:agentId", scope: "app", titleKey: "pageTitle.agent" },
  { path: "/agent", scope: "app", titleKey: "pageTitle.agents" },
  { path: "/files", scope: "app", titleKey: "pageTitle.files" },
  { path: "/cli-auth", scope: "global", titleKey: "pageTitle.cliAuth" },
  { path: "/v0-deploy-preview", scope: "global", titleKey: "pageTitle.deploymentPreview" },
  { path: "/onboarding", scope: "global", titleKey: "pageTitle.onboarding" },
  { path: "/login", scope: "global", titleKey: "pageTitle.signIn" },
  { path: "/org/settings", scope: "org", titleKey: "pageTitle.orgSettings" },
  { path: "/apps", scope: "org", titleKey: "pageTitle.apps" },
  { path: "/", scope: "app", titleKey: "pageTitle.overview" },
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
  t?: (key: string) => string;
}): string {
  const rule = findDocumentTitleRule(input.pathname);

  if (rule === null) {
    return joinDocumentTitle([input.activeAppName]);
  }

  const title =
    input.t?.(rule.titleKey) ?? DEFAULT_TITLE_TRANSLATIONS[rule.titleKey] ?? rule.titleKey;

  if (rule.scope === "app") {
    return joinDocumentTitle([title, input.activeAppName]);
  }

  if (rule.scope === "org") {
    return joinDocumentTitle([title, input.activeOrganizationName]);
  }

  return joinDocumentTitle([title]);
}

export function DocumentTitle() {
  const location = useLocation();
  const { activeApp, activeOrganization } = useAppSession();
  const { t } = useTranslation();
  const title = resolveDocumentTitle({
    activeAppName: activeApp?.name ?? null,
    activeOrganizationName: activeOrganization?.name ?? null,
    pathname: location.pathname,
    t,
  });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
