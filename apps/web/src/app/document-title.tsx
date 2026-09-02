import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";

import { useAppSession } from "./session-provider";

const PRODUCT_NAME = "mosoo";
const DEFAULT_TITLE_TRANSLATIONS: Record<string, string> = {
  "pageTitle.projects": "Projects",
  "pageTitle.mcpAuth": "MCP authorization",
  "pageTitle.projectSettings": "Project settings",
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
  "pageTitle.onboarding": "Onboarding",
  "pageTitle.signIn": "Sign in",
  "pageTitle.orgSettings": "Org settings",
  "pageTitle.overview": "Overview",
};

type DocumentTitleScope = "project" | "global" | "org";

interface DocumentTitleRule {
  path: string;
  scope: DocumentTitleScope;
  titleKey: string;
}

const DOCUMENT_TITLE_RULES: DocumentTitleRule[] = [
  { path: "/integrations/mcp/oauth-complete", scope: "project", titleKey: "pageTitle.mcpAuth" },
  { path: "/project-settings/general", scope: "project", titleKey: "pageTitle.projectSettings" },
  { path: "/project-settings/usage", scope: "project", titleKey: "pageTitle.usage" },
  { path: "/project-settings", scope: "project", titleKey: "pageTitle.projectSettings" },
  { path: "/settings/access-tokens", scope: "global", titleKey: "pageTitle.accessTokens" },
  { path: "/settings/profile", scope: "global", titleKey: "pageTitle.profile" },
  { path: "/settings", scope: "global", titleKey: "pageTitle.settings" },
  { path: "/environment/:environmentId", scope: "project", titleKey: "pageTitle.environments" },
  { path: "/environment", scope: "project", titleKey: "pageTitle.environments" },
  { path: "/integrations/skills", scope: "project", titleKey: "pageTitle.skills" },
  { path: "/integrations/mcp", scope: "project", titleKey: "pageTitle.mcpServers" },
  { path: "/providers", scope: "project", titleKey: "pageTitle.providers" },
  { path: "/threads/:threadId", scope: "project", titleKey: "pageTitle.thread" },
  { path: "/threads", scope: "project", titleKey: "pageTitle.threads" },
  { path: "/agent/:agentId", scope: "project", titleKey: "pageTitle.agent" },
  { path: "/agent", scope: "project", titleKey: "pageTitle.agents" },
  { path: "/files", scope: "project", titleKey: "pageTitle.files" },
  { path: "/cli-auth", scope: "global", titleKey: "pageTitle.cliAuth" },
  { path: "/onboarding", scope: "global", titleKey: "pageTitle.onboarding" },
  { path: "/login", scope: "global", titleKey: "pageTitle.signIn" },
  { path: "/org/settings", scope: "org", titleKey: "pageTitle.orgSettings" },
  { path: "/projects", scope: "org", titleKey: "pageTitle.projects" },
  { path: "/", scope: "project", titleKey: "pageTitle.overview" },
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
  activeProjectName: string | null;
  activeOrganizationName: string | null;
  pathname: string;
  t?: (key: string) => string;
}): string {
  const rule = findDocumentTitleRule(input.pathname);

  if (rule === null) {
    return joinDocumentTitle([input.activeProjectName]);
  }

  const title =
    input.t?.(rule.titleKey) ?? DEFAULT_TITLE_TRANSLATIONS[rule.titleKey] ?? rule.titleKey;

  if (rule.scope === "project") {
    return joinDocumentTitle([title, input.activeProjectName]);
  }

  if (rule.scope === "org") {
    return joinDocumentTitle([title, input.activeOrganizationName]);
  }

  return joinDocumentTitle([title]);
}

export function DocumentTitle() {
  const location = useLocation();
  const { activeProject, activeOrganization } = useAppSession();
  const { t } = useTranslation();
  const title = resolveDocumentTitle({
    activeProjectName: activeProject?.name ?? null,
    activeOrganizationName: activeOrganization?.name ?? null,
    pathname: location.pathname,
    t,
  });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
