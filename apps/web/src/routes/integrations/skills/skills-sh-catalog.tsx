import type { SkillsShCatalogSkill, SkillsShCatalogView } from "@mosoo/contracts/skill";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Flame,
  Info,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useReducer } from "react";

import { useSkillsShCatalogQuery } from "@/domains/skill/query/skill-queries";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { useSkillRegistry } from "./use-skill-registry";

const CATALOG_PER_PAGE = 24;

interface SkillsShCatalogState {
  error: string | null;
  installingId: string | null;
  page: number;
  view: SkillsShCatalogView;
}

type SkillsShCatalogAction =
  | { type: "clearError" }
  | { type: "installFailed"; error: string }
  | { type: "installStart"; id: string }
  | { type: "installSuccess" }
  | { type: "resetPage" }
  | { type: "setPage"; page: number }
  | { type: "setView"; view: SkillsShCatalogView };

const SKILLS_SH_CATALOG_INITIAL_STATE: SkillsShCatalogState = {
  error: null,
  installingId: null,
  page: 0,
  view: "trending",
};

function skillsShCatalogReducer(
  state: SkillsShCatalogState,
  action: SkillsShCatalogAction,
): SkillsShCatalogState {
  switch (action.type) {
    case "clearError":
      return { ...state, error: null };
    case "installFailed":
      return { ...state, error: action.error, installingId: null };
    case "installStart":
      return { ...state, error: null, installingId: action.id };
    case "installSuccess":
      return { ...state, error: null, installingId: null };
    case "resetPage":
      return { ...state, page: 0 };
    case "setPage":
      return { ...state, page: Math.max(action.page, 0) };
    case "setView":
      return { ...state, page: 0, view: action.view };
  }
}

export function SkillsShCatalog({
  onInstalled,
  registry,
  search,
}: {
  onInstalled: (skillId: string) => void;
  registry: ReturnType<typeof useSkillRegistry>;
  search: string;
}) {
  const [state, dispatch] = useReducer(skillsShCatalogReducer, SKILLS_SH_CATALOG_INITIAL_STATE);
  const { error, installingId, page, view } = state;
  const trimmedSearch = search.trim();
  const catalogQuery = useSkillsShCatalogQuery({
    enabled: isTruthy(registry.appId),
    page,
    perPage: CATALOG_PER_PAGE,
    query: trimmedSearch,
    view,
  });

  useEffect(() => {
    dispatch({ type: "resetPage" });
  }, [trimmedSearch]);

  const installedNames = useMemo(
    () => new Set(registry.personal.map((skill) => skill.name.trim().toLowerCase())),
    [registry.personal],
  );

  async function handleInstall(skill: SkillsShCatalogSkill) {
    if (installingId !== null) {
      return;
    }

    dispatch({ id: skill.id, type: "installStart" });

    try {
      const created = await registry.installSkillsShSkill({
        id: skill.id,
        installUrl: skill.installUrl,
        slug: skill.slug,
      });
      dispatch({ type: "installSuccess" });
      onInstalled(created.id);
    } catch (caughtError) {
      dispatch({
        error:
          caughtError instanceof Error ? caughtError.message : "Failed to install skills.sh skill.",
        type: "installFailed",
      });
    }
  }

  const result = catalogQuery.data;
  const skills = result?.skills ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          aria-label="skills.sh catalog view"
          className="inline-flex flex-wrap items-center gap-1"
        >
          <CatalogViewButton
            active={view === "trending"}
            icon={TrendingUp}
            label="Trending"
            onClick={() => {
              dispatch({ type: "setView", view: "trending" });
            }}
          />
          <CatalogViewButton
            active={view === "hot"}
            icon={Flame}
            label="Hot"
            onClick={() => {
              dispatch({ type: "setView", view: "hot" });
            }}
          />
          <CatalogViewButton
            active={view === "all-time"}
            icon={Check}
            label="All-time"
            onClick={() => {
              dispatch({ type: "setView", view: "all-time" });
            }}
          />
        </div>

        <div className="flex-1" />

        {result ? (
          <div className="text-fg-3 flex items-center gap-1.5 text-[12px] tabular-nums">
            <span>
              {formatCatalogCount(result.total ?? result.count)}
              {result.source === "public-page" ? " · public index" : " · skills.sh API"}
            </span>
            <SkillsShSourceTooltip source={result.source} />
          </div>
        ) : null}
      </div>

      {isTruthy(error) ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      {catalogQuery.isLoading ? (
        <div className="text-fg-3 py-12 text-center text-[13px]">Loading skills.sh…</div>
      ) : catalogQuery.error ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
          {catalogQuery.error instanceof Error
            ? catalogQuery.error.message
            : "Failed to load skills.sh."}
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title="No skills found"
          description="Try a different search term or view."
        />
      ) : (
        <div
          className={cn("grid gap-3", "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4")}
        >
          {skills.map((skill) => (
            <SkillsShCatalogCard
              authConfigured={result?.authConfigured ?? false}
              installed={installedNames.has(skill.name.trim().toLowerCase())}
              installing={installingId === skill.id}
              key={skill.id}
              onInstall={() => {
                void handleInstall(skill);
              }}
              skill={skill}
            />
          ))}
        </div>
      )}

      {result && (page > 0 || result.hasMore) ? (
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0 || catalogQuery.isFetching}
            onClick={() => {
              dispatch({ page: page - 1, type: "setPage" });
            }}
          >
            <ArrowLeft className="size-3.5" />
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!result.hasMore || catalogQuery.isFetching}
            onClick={() => {
              dispatch({ page: page + 1, type: "setPage" });
            }}
          >
            Next
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SkillsShSourceTooltip({ source }: { source: "api" | "public-page" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="skills.sh source"
          className="text-fg-3 hover:text-fg-1 focus-visible:ring-brand-ring inline-flex size-5 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-[280px] text-left">
        {source === "api"
          ? "Discover results are sourced from the skills.sh API."
          : "Discover results are sourced from the public skills.sh directory."}
      </TooltipContent>
    </Tooltip>
  );
}

function SkillsShCatalogCard({
  authConfigured,
  installed,
  installing,
  onInstall,
  skill,
}: {
  authConfigured: boolean;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
  skill: SkillsShCatalogSkill;
}) {
  const installable = authConfigured || skill.sourceType === "github";

  return (
    <article className="border-border bg-card hover:border-border-strong flex min-h-[168px] min-w-0 flex-col gap-3 rounded-lg border p-4 transition-all hover:shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-fg-1 truncate text-[14px] font-bold">{skill.name}</div>
          <a
            className="text-fg-3 hover:text-fg-1 mt-1 inline-flex max-w-full items-center gap-1 font-mono text-[11px]"
            href={skill.url}
            rel="noreferrer"
            target="_blank"
            title={skill.source}
          >
            <span className="truncate">{skill.source}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        {skill.isOfficial ? <Badge variant="success">Official</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{skill.sourceType === "github" ? "GitHub" : "Well-known"}</Badge>
        {skill.isDuplicate ? <Badge variant="warning">Duplicate</Badge> : null}
      </div>

      <div className="flex-1" />

      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="text-fg-3 min-w-0 text-[11px]">
          <span className="font-mono tabular-nums">{formatCatalogCount(skill.installs)}</span>{" "}
          installs
        </div>
        <Button
          size="sm"
          variant={installed ? "outline" : "default"}
          disabled={installed || installing || !installable}
          onClick={onInstall}
          title={installable ? undefined : "Requires skills.sh API access"}
        >
          {installed ? (
            <>
              <Check className="size-3.5" />
              Installed
            </>
          ) : installing ? (
            "Installing…"
          ) : (
            "Install"
          )}
        </Button>
      </div>
    </article>
  );
}

function CatalogViewButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors",
        active
          ? "border-border-strong bg-card text-fg-1 border shadow-sm"
          : "text-fg-3 hover:bg-paper-200/70 hover:text-fg-1",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function formatCatalogCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}
