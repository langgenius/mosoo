import type { AppVibeApp, AppVibeAppCloneUrl } from "@mosoo/contracts/app";
import {
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import {
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

import { toVibeAppStatusView } from "./vibe-app-status";

// Publish and preview refresh complete on the VibeSDK side without a status
// change, so the console keeps polling for their outcome within these windows.
const PUBLISH_WATCH_MS = 180_000;
const COMMAND_WATCH_MS = 90_000;

function ErrorLine({ message }: { message: string | null }) {
  if (message === null) {
    return null;
  }

  return (
    <div className="bg-destructive/8 rounded-md px-3 py-2 text-[12.5px]">
      <span className="text-destructive font-semibold">Something went wrong: </span>
      <span className="text-fg-2">{message}</span>
    </div>
  );
}

function StatusBadge({ vibeApp }: { vibeApp: AppVibeApp }) {
  const view = toVibeAppStatusView(vibeApp);

  if (view.badgeTone === "progress") {
    return (
      <Badge variant="warning">
        <Loader2 className="size-3 animate-spin" />
        {view.badgeLabel}
      </Badge>
    );
  }

  return (
    <Badge variant="success">
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {view.badgeLabel}
    </Badge>
  );
}

function UrlRow({ href, label }: { href: string | null; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
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
        placeholder="Build a kanban board with drag and drop, dark mode, and local persistence"
        rows={3}
        disabled={create.isPending}
      />
      <div className="flex items-center gap-3">
        <Button onClick={() => create.mutate(prompt.trim())} disabled={!canSubmit}>
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles />}
          {create.isPending ? "Planning your app…" : "Build app"}
        </Button>
        {create.isPending ? (
          <span className="text-muted-foreground text-xs">
            Drafting the blueprint usually takes under a minute.
          </span>
        ) : null}
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
  const sendPrompt = useSendAppVibeAppPromptMutation(appId);
  const canSubmit = prompt.trim().length > 0 && !sendPrompt.isPending;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={
          vibeApp.status === "generating"
            ? "Queue a change while the build runs, e.g. use a green color scheme"
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
                onCommandAccepted(COMMAND_WATCH_MS);
              },
            });
          }}
        >
          {sendPrompt.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Send to builder
        </Button>
      </div>
      <ErrorLine message={sendPrompt.error?.message ?? null} />
    </div>
  );
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
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={deleteVibeApp.isPending}
          onClick={() => {
            if (window.confirm("Delete this app and its preview/production deployments?")) {
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
        <UrlRow label="Production" href={vibeApp.productionUrl} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!view.canPublish || publish.isPending}
          onClick={() => {
            publish.mutate(undefined, { onSuccess: () => onCommandAccepted(PUBLISH_WATCH_MS) });
          }}
        >
          {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <Rocket />}
          {view.productionState === "live" ? "Publish update" : "Publish"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshPreview.isPending}
          onClick={() => {
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
          disabled={cloneUrl.isPending}
          onClick={() => {
            cloneUrl.mutate(undefined, { onSuccess: setCloneResult });
          }}
        >
          {cloneUrl.isPending ? <Loader2 className="size-4 animate-spin" /> : <GitBranch />}
          Get the code
        </Button>
      </div>

      {cloneResult !== null ? (
        <div className="bg-muted/60 flex flex-col gap-1 rounded-md px-3 py-2">
          <code className="text-fg-2 text-xs break-all select-all">
            git clone {cloneResult.cloneUrl}
          </code>
          <span className="text-muted-foreground text-[11px]">
            This URL embeds a temporary access token — treat it as a secret. Expires{" "}
            {new Date(cloneResult.expiresAt).toLocaleString()}.
          </span>
        </div>
      ) : null}

      {view.canPublish ? null : (
        <p className="text-muted-foreground text-xs">
          Publish unlocks once the build is ready. The preview updates while the builder works.
        </p>
      )}

      <ErrorLine message={actionError} />

      <FollowUpCard appId={appId} onCommandAccepted={onCommandAccepted} vibeApp={vibeApp} />
    </section>
  );
}

/**
 * The App Overview vibe surface: create the App's web app from a prompt,
 * watch the live preview while the VibeSDK builder works, iterate with
 * follow-up prompts, and publish to the production URL.
 */
function StatusErrorRecovery({ appId, message }: { appId: string; message: string }) {
  const deleteVibeApp = useDeleteAppVibeAppMutation(appId);

  return (
    <div className="flex flex-col gap-3">
      <ErrorLine message={message} />
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={deleteVibeApp.isPending}
          onClick={() => {
            if (window.confirm("Remove this app binding? You can build a new app afterwards.")) {
              deleteVibeApp.mutate();
            }
          }}
        >
          {deleteVibeApp.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 />}
          Remove app binding
        </Button>
        <span className="text-muted-foreground text-xs">
          Use this if the app was removed on the backend and the status can no longer load.
        </span>
      </div>
      <ErrorLine message={deleteVibeApp.error?.message ?? null} />
    </div>
  );
}

export function VibeSurface({
  appId,
  appName,
  emptyHero,
  headerActions,
}: {
  appId: string;
  appName: string;
  /** Content rendered below the create card before the first build. */
  emptyHero?: ReactNode;
  /** Right-aligned header extras. */
  headerActions?: ReactNode;
}) {
  const [activityDeadlineMs, setActivityDeadlineMs] = useState(0);
  const vibeAppQuery = useAppVibeAppQuery(appId, activityDeadlineMs);
  const vibeApp = vibeAppQuery.data ?? null;
  const watchFor = (watchMs: number) => setActivityDeadlineMs(Date.now() + watchMs);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{appName}</h1>
          <AppIdBadge appId={appId} />
        </div>
        <div className="flex gap-2">{headerActions}</div>
      </div>

      {vibeAppQuery.isError ? (
        <StatusErrorRecovery appId={appId} message={vibeAppQuery.error.message} />
      ) : vibeAppQuery.isPending ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading app status…
        </div>
      ) : vibeApp === null ? (
        <>
          <CreateVibeAppCard appId={appId} />
          {emptyHero}
        </>
      ) : (
        <VibeAppCard appId={appId} onCommandAccepted={watchFor} vibeApp={vibeApp} />
      )}
    </div>
  );
}
