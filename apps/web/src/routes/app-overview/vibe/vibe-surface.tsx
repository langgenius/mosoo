import type { AppVibeApp, AppVibeAppCloneUrl } from "@mosoo/contracts/app";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  KeyRound,
  Loader2,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  useAppVibeAppEnabledQuery,
  useAppVibeAppQuery,
  useCreateAppVibeAppCloneUrlMutation,
  useCreateAppVibeAppMutation,
  useDeleteAppVibeAppMutation,
  usePublishAppVibeAppMutation,
  useRefreshAppVibeAppPreviewMutation,
  useSendAppVibeAppPromptMutation,
} from "@/domains/app/query/vibe-app-queries";
import { AppIdBadge } from "@/shared/ui/app-id-badge";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

import { AppOverviewInstallGuide } from "../app-overview-install";
import { toVibeAppStatusView } from "./vibe-app-status";

// Publish and preview refresh complete on the VibeSDK side without a status
// change, so the console keeps polling for their outcome within these windows.
const PUBLISH_WATCH_MS = 180_000;
const COMMAND_WATCH_MS = 90_000;

function watchStorageKey(appId: string): string {
  return `vibe-app-watch:${appId}`;
}

function readStoredWatchDeadline(appId: string): number {
  const raw = sessionStorage.getItem(watchStorageKey(appId));
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > Date.now() ? parsed : 0;
}

function ErrorLine({ message }: { message: string | null }) {
  if (message === null) {
    return null;
  }

  return (
    <div role="alert" className="bg-destructive/8 rounded-md px-3 py-2 text-[12.5px]">
      <span className="text-destructive font-semibold">Something went wrong: </span>
      <span className="text-fg-2">{message}</span>
    </div>
  );
}

function StatusBadge({ vibeApp }: { vibeApp: AppVibeApp }) {
  if (vibeApp.status !== "ready") {
    return (
      <Badge variant="warning">
        <Loader2 className="size-3 animate-spin" />
        {vibeApp.status === "creating" ? "Planning" : "Building"}
      </Badge>
    );
  }

  return (
    <Badge variant="success">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      Ready
    </Badge>
  );
}

function UrlRow({
  href,
  label,
  trailing,
}: {
  href: string | null;
  label: string;
  trailing?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {trailing ? (
          <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
            <Loader2 className="size-3 animate-spin" />
            {trailing}
          </span>
        ) : null}
        {href === null ? (
          <span className="text-muted-foreground/70">Not available yet</span>
        ) : (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary inline-flex min-w-0 items-center gap-1 font-medium hover:underline"
          >
            <span className="truncate">{href.replace(/^https?:\/\//, "")}</span>
            <ExternalLink className="size-3.5 shrink-0" />
          </a>
        )}
      </span>
    </div>
  );
}

function CreateVibeAppCard({ appId }: { appId: string }) {
  const [prompt, setPrompt] = useState("");
  const create = useCreateAppVibeAppMutation(appId);
  const canSubmit = prompt.trim().length > 0 && !create.isPending;

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="text-primary size-4" />
        <h2 className="text-sm font-semibold">Build a web app</h2>
      </div>
      <p className="text-muted-foreground text-sm">
        Describe the app you want. Mosoo builds it, shows a live preview, and publishes it to a
        public URL when you are ready.
      </p>
      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        aria-label="Describe the app to build"
        placeholder="Build a kanban board with drag and drop, dark mode, and local persistence"
        rows={3}
        disabled={create.isPending}
      />
      <div className="flex items-center gap-3">
        <Button onClick={() => create.mutate(prompt.trim())} disabled={!canSubmit}>
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles />}
          Build app
        </Button>
      </div>
      <ErrorLine message={create.error?.message ?? null} />
    </section>
  );
}

function FollowUpCard({
  appId,
  onCommandAccepted,
  vibeApp,
}: {
  appId: string;
  onCommandAccepted: (watchMs: number) => void;
  vibeApp: AppVibeApp;
}) {
  const [prompt, setPrompt] = useState("");
  const [sentAtMs, setSentAtMs] = useState<number | null>(null);
  const sendPrompt = useSendAppVibeAppPromptMutation(appId);
  const canSubmit = prompt.trim().length > 0 && !sendPrompt.isPending;
  const showSentNote =
    sentAtMs !== null && vibeApp.status === "ready" && Date.now() - sentAtMs < COMMAND_WATCH_MS;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        aria-label="Send a change request to the builder"
        placeholder={
          vibeApp.status === "generating"
            ? "Request a change for the current build, e.g. use a green color scheme"
            : "Iterate on the app, e.g. fix the empty state or add CSV export"
        }
        rows={2}
        disabled={sendPrompt.isPending}
      />
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={!canSubmit}
          onClick={() => {
            sendPrompt.mutate(prompt.trim(), {
              onSuccess: () => {
                setPrompt("");
                setSentAtMs(Date.now());
                onCommandAccepted(COMMAND_WATCH_MS);
              },
            });
          }}
        >
          {sendPrompt.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Send to builder
        </Button>
        {showSentNote ? (
          <span className="text-muted-foreground text-xs">
            Change sent — the builder picks it up shortly.
          </span>
        ) : null}
      </div>
      <ErrorLine message={sendPrompt.error?.message ?? null} />
    </div>
  );
}

function CloneUrlPanel({ cloneResult }: { cloneResult: AppVibeAppCloneUrl }) {
  const [copied, setCopied] = useState(false);
  const expiresAtMs = Date.parse(cloneResult.expiresAt);

  if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
    return null;
  }

  const command = `git clone ${cloneResult.cloneUrl}`;

  return (
    <div className="bg-muted/60 flex flex-col gap-1 rounded-md px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <code className="text-fg-2 text-xs break-all select-all">{command}</code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy clone command"
          onClick={() => {
            void navigator.clipboard?.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2_000);
            });
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <span className="text-muted-foreground text-[11px]">
        This URL embeds a temporary access token — treat it as a secret.
        {Number.isFinite(expiresAtMs)
          ? ` Expires ${new Date(expiresAtMs).toLocaleString()}.`
          : null}
      </span>
    </div>
  );
}

const CREATE_STALL_HINT_MS = 5 * 60_000;

function CreatingCard({ appId, vibeApp }: { appId: string; vibeApp: AppVibeApp }) {
  const deleteVibeApp = useDeleteAppVibeAppMutation(appId);
  const elapsedMs = Date.now() - Date.parse(vibeApp.createdAt);

  return (
    <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold">Planning your app</h2>
          <StatusBadge vibeApp={vibeApp} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={deleteVibeApp.isPending}
          onClick={() => {
            if (window.confirm("Cancel this build and remove the app?")) {
              deleteVibeApp.mutate();
            }
          }}
        >
          {deleteVibeApp.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 />}
          Cancel
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        The builder is drafting the blueprint for your app. This usually takes a minute or two; the
        console updates by itself.
      </p>
      {elapsedMs > CREATE_STALL_HINT_MS ? (
        <p className="text-muted-foreground text-xs">
          This is taking unusually long. You can cancel and try again.
        </p>
      ) : null}
      <ErrorLine message={deleteVibeApp.error?.message ?? null} />
    </section>
  );
}

interface PublishWatch {
  baselinePublishedAt: string | null;
  sinceMs: number;
}

function VibeAppCard({
  appId,
  onCommandAccepted,
  vibeApp,
}: {
  appId: string;
  /** Called when a fire-and-forget command is accepted, to keep polling. */
  onCommandAccepted: (watchMs: number) => void;
  vibeApp: AppVibeApp;
}) {
  const view = toVibeAppStatusView(vibeApp);
  const publish = usePublishAppVibeAppMutation(appId);
  const refreshPreview = useRefreshAppVibeAppPreviewMutation(appId);
  const cloneUrl = useCreateAppVibeAppCloneUrlMutation(appId);
  const deleteVibeApp = useDeleteAppVibeAppMutation(appId);
  const [cloneResult, setCloneResult] = useState<AppVibeAppCloneUrl | null>(null);
  const [publishWatch, setPublishWatch] = useState<PublishWatch | null>(null);

  const resetActionErrors = () => {
    publish.reset();
    refreshPreview.reset();
    cloneUrl.reset();
    deleteVibeApp.reset();
  };

  const publishOutcomePending =
    publishWatch !== null && vibeApp.lastPublishedAt === publishWatch.baselinePublishedAt;
  const publishInFlight =
    publishOutcomePending && Date.now() - publishWatch.sinceMs < PUBLISH_WATCH_MS;
  const publishStalled = publishOutcomePending && !publishInFlight;
  const busy = deleteVibeApp.isPending;

  const actionError =
    publish.error?.message ??
    refreshPreview.error?.message ??
    cloneUrl.error?.message ??
    deleteVibeApp.error?.message ??
    null;

  return (
    <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{vibeApp.title ?? "Untitled app"}</h2>
          <StatusBadge vibeApp={vibeApp} />
          <span className="text-muted-foreground text-xs">
            Updated {new Date(vibeApp.updatedAt).toLocaleTimeString()}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={deleteVibeApp.isPending}
          onClick={() => {
            if (
              window.confirm(
                "Delete this app? Anything already published may keep serving until platform cleanup.",
              )
            ) {
              resetActionErrors();
              deleteVibeApp.mutate();
            }
          }}
        >
          {deleteVibeApp.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 />}
          Delete
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <UrlRow label="Preview" href={vibeApp.previewUrl} />
        <UrlRow
          label="Production"
          href={vibeApp.productionUrl}
          trailing={publishInFlight ? "Publishing…" : null}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!view.ready || publish.isPending || publishInFlight || busy}
          onClick={() => {
            resetActionErrors();
            publish.mutate(undefined, {
              onSuccess: () => {
                setPublishWatch({
                  baselinePublishedAt: vibeApp.lastPublishedAt,
                  sinceMs: Date.now(),
                });
                onCommandAccepted(PUBLISH_WATCH_MS);
              },
            });
          }}
        >
          {publish.isPending || publishInFlight ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Rocket />
          )}
          {view.live ? "Publish update" : "Publish"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshPreview.isPending || busy}
          onClick={() => {
            resetActionErrors();
            refreshPreview.mutate(undefined, {
              onSuccess: () => onCommandAccepted(COMMAND_WATCH_MS),
            });
          }}
        >
          {refreshPreview.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw />}
          Refresh preview
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={cloneUrl.isPending || busy}
          onClick={() => {
            resetActionErrors();
            cloneUrl.mutate(undefined, { onSuccess: setCloneResult });
          }}
        >
          {cloneUrl.isPending ? <Loader2 className="size-4 animate-spin" /> : <GitBranch />}
          Get the code
        </Button>
      </div>

      {publishStalled ? (
        <p className="text-muted-foreground text-xs">
          The publish has not reported back yet — the production URL updates here once it completes,
          or you can publish again.
        </p>
      ) : null}

      {cloneResult !== null ? <CloneUrlPanel cloneResult={cloneResult} /> : null}

      {view.ready ? null : (
        <p className="text-muted-foreground text-xs">
          Publish unlocks once the build is ready. The preview updates while the builder works.
        </p>
      )}

      <ErrorLine message={actionError} />

      <FollowUpCard appId={appId} onCommandAccepted={onCommandAccepted} vibeApp={vibeApp} />
    </section>
  );
}

function StatusErrorRecovery({
  appId,
  message,
  onRetry,
}: {
  appId: string;
  message: string;
  onRetry: () => void;
}) {
  const deleteVibeApp = useDeleteAppVibeAppMutation(appId);

  return (
    <div className="flex flex-col gap-3">
      <ErrorLine message={message} />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={onRetry}>
          <RefreshCw />
          Retry
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={deleteVibeApp.isPending}
          onClick={() => {
            if (
              window.confirm(
                "Delete this app? If it still exists on the backend it is deleted there too, and anything already published may keep serving until platform cleanup.",
              )
            ) {
              deleteVibeApp.mutate();
            }
          }}
        >
          {deleteVibeApp.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 />}
          Delete app
        </Button>
        <span className="text-muted-foreground text-xs">
          Delete only if the app is gone on the backend and the status can no longer load.
        </span>
      </div>
      <ErrorLine message={deleteVibeApp.error?.message ?? null} />
    </div>
  );
}

function UnavailableNote() {
  return (
    <section className="border-border bg-card flex flex-col gap-2 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Web app building is not available here</h2>
      <p className="text-muted-foreground text-sm">
        This deployment has no VibeSDK backend configured. Set VIBESDK_BASE_URL and VIBESDK_API_KEY
        on the API worker to enable it.
      </p>
    </section>
  );
}

/**
 * The App Overview vibe surface: create the App's web app from a prompt,
 * watch the live preview while the VibeSDK builder works, iterate with
 * follow-up prompts, and publish to the production URL.
 */
export function VibeSurface({ appId, appName }: { appId: string; appName: string }) {
  const [activityDeadlineMs, setActivityDeadlineMs] = useState(() =>
    readStoredWatchDeadline(appId),
  );
  const enabledQuery = useAppVibeAppEnabledQuery();
  const vibeAppQuery = useAppVibeAppQuery(appId, activityDeadlineMs);
  const vibeApp = vibeAppQuery.data ?? null;
  const watchFor = (watchMs: number) => {
    const deadline = Date.now() + watchMs;
    sessionStorage.setItem(watchStorageKey(appId), String(deadline));
    setActivityDeadlineMs(deadline);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{appName}</h1>
          <AppIdBadge appId={appId} />
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/providers">
              <KeyRound />
              Provider keys
            </Link>
          </Button>
          <Button asChild>
            <Link to="/agent?create=1">
              <Bot />
              New agent
            </Link>
          </Button>
        </div>
      </div>

      {vibeAppQuery.isError && vibeApp === null ? (
        <StatusErrorRecovery
          appId={appId}
          message={vibeAppQuery.error.message}
          onRetry={() => {
            void vibeAppQuery.refetch();
          }}
        />
      ) : vibeAppQuery.isPending ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading app status…
        </div>
      ) : vibeApp === null ? (
        enabledQuery.data === false ? (
          <UnavailableNote />
        ) : (
          <>
            <CreateVibeAppCard appId={appId} />
            <AppOverviewInstallGuide />
          </>
        )
      ) : vibeApp.status === "creating" ? (
        <CreatingCard appId={appId} vibeApp={vibeApp} />
      ) : (
        <>
          {vibeAppQuery.isError ? (
            <ErrorLine message="Live status is temporarily unavailable — retrying." />
          ) : null}
          <VibeAppCard appId={appId} onCommandAccepted={watchFor} vibeApp={vibeApp} />
        </>
      )}
    </div>
  );
}
