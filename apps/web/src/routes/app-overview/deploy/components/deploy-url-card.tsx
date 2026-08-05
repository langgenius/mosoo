import { ExternalLink } from "lucide-react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";

import type { DeploymentRunVM, DeploymentVM } from "../deploy-console-data";
import { hostOf, relativeLabel } from "../deploy-console-mapping";
import type {
  LocalDeploymentPreviewState,
  LocalDeploymentPreviewStatus,
} from "../local-preview-url";
import { useNowTick } from "../use-now-tick";
import { StatusBadge } from "./deploy-status-badge";

function DomainLink({ url, large }: { url: string; large?: boolean | undefined }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "text-fg-1 hover:text-accent-press inline-flex min-w-0 items-center gap-1.5 font-semibold transition-colors hover:underline",
        large ? "text-[15px]" : "text-[13.5px]",
      )}
    >
      <span className="truncate">{hostOf(url)}</span>
      <ExternalLink className="text-fg-3 size-3.5 shrink-0" />
    </a>
  );
}

function DomainRow({
  label,
  url,
  large,
}: {
  label: string;
  url: string;
  large?: boolean | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
      <span className="text-fg-3">{label}</span>
      <DomainLink url={url} large={large} />
    </div>
  );
}

function DevelopmentPreviewRow({
  status,
  url,
}: {
  status: LocalDeploymentPreviewStatus;
  url: string | null;
}) {
  const { t } = useTranslation();

  if (url === null) {
    return null;
  }

  const online = status === "online";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
      <span className="text-fg-3">{t("deploy.developmentPreview")}</span>
      {online ? (
        <DomainLink url={url} />
      ) : (
        <span className="text-fg-2 min-w-0 truncate font-semibold">{hostOf(url)}</span>
      )}
      <span
        className={cn(
          "inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium",
          online
            ? "bg-success-bg text-success-fg"
            : status === "checking"
              ? "bg-amber-bg text-amber-fg"
              : "bg-bg-sunken text-fg-3",
        )}
      >
        {online
          ? t("deploy.statusReady")
          : status === "checking"
            ? t("deploy.statusChecking")
            : t("deploy.statusOffline")}
      </span>
    </div>
  );
}

/**
 * Environment links for the deployed hero — unboxed label/value typography, no
 * card chrome. Production deploy and development preview are separate pipes: a
 * failed or preparing production deploy can still have a healthy local preview.
 */
export function DeployUrlCard({
  deployment,
  latestRun,
  localPreview,
}: {
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
  localPreview: LocalDeploymentPreviewState;
}) {
  const { t } = useTranslation();
  const now = useNowTick();
  const inFlight = latestRun?.outcome === "deploying";
  const failed = latestRun?.outcome === "failed";
  const productionUrl = deployment.liveUrl ?? deployment.plannedUrl;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-fg-3 text-[13px]">{t("nav.environments")}</div>

      {inFlight && latestRun !== undefined ? (
        <div className="flex flex-col gap-2.5">
          <DevelopmentPreviewRow status={localPreview.status} url={localPreview.url} />
          <StatusBadge outcome={latestRun.outcome} scopeLabel={t("cost.production")} />
          {deployment.liveUrl === null ? null : (
            <DomainRow label={t("deploy.productionServing")} url={deployment.liveUrl} />
          )}
          {deployment.liveUrl !== null || deployment.plannedUrl === null ? null : (
            <DomainRow label={t("deploy.productionReserved")} url={deployment.plannedUrl} />
          )}
        </div>
      ) : failed && latestRun !== undefined ? (
        <div className="flex flex-col gap-2.5">
          <DevelopmentPreviewRow status={localPreview.status} url={localPreview.url} />
          {deployment.liveUrl === null ? null : (
            <div className="flex min-w-0 flex-col gap-1">
              <DomainRow label={t("deploy.productionServing")} url={deployment.liveUrl} />
              <p className="text-fg-3 text-[13px]">{t("deploy.liveSiteUnaffected")}</p>
            </div>
          )}
          {deployment.liveUrl !== null || deployment.plannedUrl === null ? null : (
            <DomainRow label={t("deploy.productionReserved")} url={deployment.plannedUrl} />
          )}
        </div>
      ) : productionUrl !== null ? (
        <div className="flex flex-col gap-1">
          <DomainRow
            label={
              deployment.liveUrl === null
                ? t("deploy.productionReserved")
                : t("deploy.productionLive")
            }
            url={productionUrl}
            large
          />
          <DevelopmentPreviewRow status={localPreview.status} url={localPreview.url} />
          {latestRun === undefined ? null : (
            <div className="text-fg-3 text-[13px]">
              {latestRun.number === null
                ? null
                : `${t("deploy.deployNumbered", { number: String(latestRun.number) })} · `}
              <span className="font-mono">{latestRun.commitSha}</span> ·{" "}
              {relativeLabel(latestRun.createdAt, now, t)}
            </div>
          )}
        </div>
      ) : localPreview.url !== null ? (
        <DevelopmentPreviewRow status={localPreview.status} url={localPreview.url} />
      ) : (
        <p className="text-fg-3 text-[13px]">{t("deploy.noUrlYet")}</p>
      )}
    </div>
  );
}
