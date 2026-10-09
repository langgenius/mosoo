import type { SkillsShCatalogSkill, SkillsShCatalogView } from "@mosoo/contracts/skill";
import type { SkillId } from "@mosoo/id";
import { useMemo, useState } from "react";

import { useSkillsShCatalogQuery } from "@/domains/skill/query/skill-queries";
import { getCurrentLocale, useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { EmptyState } from "@/shared/ui/empty-state";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Flame,
  Info,
  RefreshCw,
  TrendingUp,
} from "@/shared/ui/icons";
import type { AppIcon } from "@/shared/ui/icons";
import { Switch } from "@/shared/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { useSkillRegistry } from "./use-skill-registry";

const CATALOG_PER_PAGE = 24;

function formatCount(value: number): string {
  return new Intl.NumberFormat(getCurrentLocale(), {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}

export function SkillsShCatalog({
  onInstalled,
  registry,
  search,
}: {
  onInstalled: (skillId: SkillId) => void;
  registry: ReturnType<typeof useSkillRegistry>;
  search: string;
}) {
  const { t } = useTranslation();
  const [availableOnly, setAvailableOnly] = useState(true);
  const [view, setView] = useState<SkillsShCatalogView>("trending");
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [confirmingSkill, setConfirmingSkill] = useState<SkillsShCatalogSkill | null>(null);
  const trimmedSearch = search.trim();
  // The page belongs to one search; a new search starts again at page 0.
  const [paging, setPaging] = useState({ page: 0, search: trimmedSearch });
  const page = paging.search === trimmedSearch ? paging.page : 0;
  const catalogQuery = useSkillsShCatalogQuery({
    availableOnly,
    page,
    perPage: CATALOG_PER_PAGE,
    query: trimmedSearch,
    view,
  });

  const installedNames = useMemo(
    () => new Set(registry.skills.map((skill) => skill.name.trim().toLowerCase())),
    [registry.skills],
  );

  function goToPage(nextPage: number): void {
    setPaging({ page: nextPage, search: trimmedSearch });
  }

  function selectView(nextView: SkillsShCatalogView): void {
    setView(nextView);
    goToPage(0);
  }

  async function handleInstall(skill: SkillsShCatalogSkill) {
    if (installingId !== null) {
      return;
    }

    setError(null);
    setInstallingId(skill.id);

    try {
      const created = await registry.installSkillsShSkill({
        id: skill.id,
        installUrl: skill.installUrl,
        slug: skill.slug,
      });
      setInstallingId(null);
      setConfirmingSkill(null);
      onInstalled(created.id);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t("skills.failedToInstall"));
      setInstallingId(null);
    }
  }

  const result = catalogQuery.data;
  const skills = result?.skills ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          aria-label={t("skills.catalogView")}
          className="inline-flex flex-wrap items-center gap-1"
        >
          <CatalogViewButton
            active={view === "trending"}
            icon={TrendingUp}
            label={t("skills.trending")}
            onClick={() => {
              selectView("trending");
            }}
          />
          <CatalogViewButton
            active={view === "hot"}
            icon={Flame}
            label={t("skills.hot")}
            onClick={() => {
              selectView("hot");
            }}
          />
          <CatalogViewButton
            active={view === "all-time"}
            icon={Check}
            label={t("skills.allTime")}
            onClick={() => {
              selectView("all-time");
            }}
          />
        </div>

        <label
          className="border-border bg-card text-fg-2 inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-[12.5px] font-medium"
          htmlFor="skills-sh-show-available-only"
        >
          <Switch
            checked={availableOnly}
            id="skills-sh-show-available-only"
            onCheckedChange={(checked) => {
              setAvailableOnly(checked);
              goToPage(0);
            }}
          />
          {t("skills.showAvailableOnly")}
        </label>

        <div className="flex-1" />

        {result ? (
          <div className="text-fg-3 flex items-center gap-1.5 text-[12px] tabular-nums">
            <span>
              {formatCount(result.total ?? result.count)}
              {result.source === "public-page" ? t("skills.publicIndex") : t("skills.skillsShApi")}
            </span>
            <SkillsShSourceTooltip source={result.source} />
          </div>
        ) : null}
      </div>

      {isTruthy(error) ? (
        <div className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-xs">
          {error}
        </div>
      ) : null}

      {catalogQuery.isLoading ? (
        <div className="text-fg-3 py-12 text-center text-[13px]">{t("skills.loadingSkillsSh")}</div>
      ) : catalogQuery.error ? (
        <div className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-xs">
          {catalogQuery.error instanceof Error
            ? catalogQuery.error.message
            : t("skills.failedToLoad")}
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={t("skills.noSkillsFound")}
          description={t("skills.tryDifferentSearch")}
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
                setConfirmingSkill(skill);
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
              goToPage(page - 1);
            }}
          >
            <ArrowLeft className="size-3.5" />
            {t("skills.previous")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!result.hasMore || catalogQuery.isFetching}
            onClick={() => {
              goToPage(page + 1);
            }}
          >
            {t("skills.next")}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      ) : null}

      <SkillsShInstallConfirmDialog
        installing={confirmingSkill !== null && installingId === confirmingSkill.id}
        onConfirm={(skill) => {
          void handleInstall(skill);
        }}
        onOpenChange={(open) => {
          if (!open && installingId === null) {
            setConfirmingSkill(null);
          }
        }}
        skill={confirmingSkill}
      />
    </div>
  );
}

function SkillsShSourceTooltip({ source }: { source: "api" | "public-page" }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("skills.source")}
          className="text-fg-3 hover:text-fg-1 focus-visible:ring-ring inline-flex size-5 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-[280px] text-left">
        {source === "api" ? t("skills.sourceApiTooltip") : t("skills.sourcePublicTooltip")}
      </TooltipContent>
    </Tooltip>
  );
}

function SkillsShInstallConfirmDialog({
  installing,
  onConfirm,
  onOpenChange,
  skill,
}: {
  installing: boolean;
  onConfirm: (skill: SkillsShCatalogSkill) => void;
  onOpenChange: (open: boolean) => void;
  skill: SkillsShCatalogSkill | null;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={skill !== null} onOpenChange={onOpenChange}>
      {skill ? (
        <DialogContent className="z-[60] sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{t("skills.installTitle", { name: skill.name })}</DialogTitle>
            <DialogDescription>{t("skills.installDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="border-border bg-card rounded-lg border p-6">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-fg-heading truncate text-[15px] font-semibold">
                    {skill.name}
                  </div>
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
                {skill.isOfficial ? <Badge variant="success">{t("skills.official")}</Badge> : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">
                  {skill.sourceType === "github" ? "GitHub" : "Well-known"}
                </Badge>
                {skill.isDuplicate ? (
                  <Badge variant="warning">{t("skills.duplicate")}</Badge>
                ) : null}
                <Badge variant="default">
                  {formatCount(skill.installs)} {t("common.installs")}
                </Badge>
              </div>
            </div>

            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
              <dt className="text-fg-3">{t("skills.registry")}</dt>
              <dd className="text-fg-1 min-w-0">skills.sh</dd>
              <dt className="text-fg-3">{t("skills.skillId")}</dt>
              <dd className="text-fg-1 min-w-0 truncate font-mono" title={skill.id}>
                {skill.id}
              </dd>
              <dt className="text-fg-3">{t("skills.slug")}</dt>
              <dd className="text-fg-1 min-w-0 truncate font-mono" title={skill.slug}>
                {skill.slug}
              </dd>
              <dt className="text-fg-3">{t("skills.installFrom")}</dt>
              <dd className="text-fg-1 min-w-0 truncate font-mono" title={skill.installUrl ?? ""}>
                {skill.installUrl ?? "skills.sh API"}
              </dd>
            </dl>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={installing}
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={installing}
              onClick={() => {
                onConfirm(skill);
              }}
            >
              {installing ? t("skills.installing") : t("skills.installSkill")}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
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
  const { t } = useTranslation();
  const installable = authConfigured || skill.sourceType === "github";
  const installRequiresApi = !installable && skill.sourceType === "well-known";

  return (
    <article className="border-border bg-card hover:border-border-strong flex min-h-[168px] min-w-0 flex-col gap-3 rounded-lg border p-4 transition-[border-color] duration-150 ease-out">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-fg-heading truncate text-[14px] font-semibold">{skill.name}</div>
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
        {skill.isOfficial ? <Badge variant="success">{t("skills.official")}</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{skill.sourceType === "github" ? "GitHub" : "Well-known"}</Badge>
        {skill.isDuplicate ? <Badge variant="warning">{t("skills.duplicate")}</Badge> : null}
      </div>

      <div className="flex-1" />

      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="text-fg-3 min-w-0 text-[11px]">
          <span className="font-mono tabular-nums">{formatCount(skill.installs)}</span>{" "}
          {t("common.installs")}
        </div>
        {installRequiresApi ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                aria-disabled="true"
                aria-label={t("skills.cannotInstallLabel", { name: skill.name })}
                className="bg-paper-300 text-fg-3 hover:bg-paper-300 active:bg-paper-300 cursor-not-allowed border-transparent shadow-none"
                onClick={(event) => {
                  event.preventDefault();
                }}
              >
                {t("skills.apiRequired")}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="max-w-[280px] text-left">
              {t("skills.apiRequiredTooltip")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <Button
            size="sm"
            variant={installed ? "outline" : "default"}
            disabled={installed || installing}
            onClick={onInstall}
          >
            {installed ? (
              <>
                <Check className="size-3.5" />
                {t("skills.installed")}
              </>
            ) : installing ? (
              t("skills.installing")
            ) : (
              t("skills.install")
            )}
          </Button>
        )}
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
  icon: AppIcon;
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
        active ? "bg-selected text-fg-1" : "text-fg-2 hover:bg-hover hover:text-fg-1",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
