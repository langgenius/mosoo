import type { HarnessCatalogEntry, HarnessSlug } from "@mosoo/contracts/harness";
import { listHarnessCatalog } from "@mosoo/runtime-catalog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useReducer } from "react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import {
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
} from "@/domains/auth/api/workspace-api-key-client";
import { createWorkspaceRun } from "@/domains/run/api/workspace-run-client";
import { useTranslation } from "@/shared/i18n";
import { writeClipboardText } from "@/shared/lib/clipboard";
import { AppIdBadge } from "@/shared/ui/app-id-badge";
import { Badge } from "@/shared/ui/badge";
import { RuntimeIcon } from "@/shared/ui/brand-icons";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

interface OverviewState {
  apiKey: string;
  copied: boolean;
  createdKey: string | null;
  environment: string;
  selectedHarness: HarnessSlug;
  task: string;
}

type OverviewAction =
  | { type: "apiKey"; value: string }
  | { type: "copied"; value: boolean }
  | { type: "createdKey"; value: string }
  | { type: "environment"; value: string }
  | { type: "harness"; value: HarnessSlug }
  | { type: "task"; value: string };

const HARNESSES = listHarnessCatalog();
const INITIAL_STATE: OverviewState = {
  apiKey: "",
  copied: false,
  createdKey: null,
  environment: "",
  selectedHarness: HARNESSES[0]?.slug ?? "claude-code",
  task: "",
};

function reducer(state: OverviewState, action: OverviewAction): OverviewState {
  switch (action.type) {
    case "apiKey":
      return { ...state, apiKey: action.value };
    case "copied":
      return { ...state, copied: action.value };
    case "createdKey":
      return { ...state, apiKey: action.value, createdKey: action.value };
    case "environment":
      return { ...state, environment: action.value };
    case "harness":
      return { ...state, selectedHarness: action.value };
    case "task":
      return { ...state, task: action.value };
  }
}

function displayWorkspaceName(name: string, t: (key: string) => string): string {
  return name === "Default App" ? t("harnessMarketplace.defaultWorkspace") : name;
}

export function AppOverviewPage() {
  const { activeApp, appsLoading } = useAppSession();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const keyQueryKey = ["auth", "workspace-api-keys", activeApp?.id ?? null] as const;
  const keysQuery = useQuery({
    enabled: activeApp !== null,
    queryFn: async () => listWorkspaceApiKeys(activeApp!.id),
    queryKey: keyQueryKey,
  });
  const createKeyMutation = useMutation({
    mutationFn: async () => {
      if (activeApp === null) throw new Error(t("common.noApp"));
      return createWorkspaceApiKey(activeApp.id, t("harnessMarketplace.quickstartKeyLabel"));
    },
    onSuccess: (response) => {
      dispatch({ type: "createdKey", value: response.value });
      void queryClient.invalidateQueries({ queryKey: keyQueryKey });
    },
  });
  const runMutation = useMutation({
    mutationFn: async () => {
      const environment = state.environment.trim();
      const harness = HARNESSES.find((entry) => entry.slug === state.selectedHarness);

      if (harness === undefined || harness.status !== "available") {
        throw new Error(t("harnessMarketplace.unavailable"));
      }

      return createWorkspaceRun(state.apiKey, {
        ...(environment.length === 0 ? {} : { environment }),
        harness: state.selectedHarness,
        input: state.task.trim(),
        profile: harness.defaultProfile,
      });
    },
  });
  const selectedHarness = useMemo(
    () => HARNESSES.find((harness) => harness.slug === state.selectedHarness) ?? HARNESSES[0],
    [state.selectedHarness],
  );

  if (activeApp === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? t("common.loadingApp") : t("common.noApp")}
      </div>
    );
  }

  const activeKeyCount = (keysQuery.data?.keys ?? []).filter(
    (key) => key.revokedAt === null,
  ).length;
  const copyCreatedKey = async () => {
    if (state.createdKey === null || !(await writeClipboardText(state.createdKey))) return;
    dispatch({ type: "copied", value: true });
    globalThis.setTimeout(() => dispatch({ type: "copied", value: false }), 1500);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 flex-col items-start justify-between gap-4 border-b px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:px-8">
        <div className="min-w-0">
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase">
            <Box className="size-3.5" />
            {t("harnessMarketplace.workspace")}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-foreground min-w-0 truncate text-2xl font-semibold">
              {displayWorkspaceName(activeApp.name, t)}
            </h1>
            <AppIdBadge appId={activeApp.id} />
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/api-keys">
            <KeyRound className="size-4" />
            {t("harnessMarketplace.apiKeys")}
            <span className="bg-secondary rounded px-1.5 py-0.5 text-[10px]">{activeKeyCount}</span>
          </Link>
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <section className="relative overflow-hidden rounded-2xl bg-[#10150d] px-5 py-8 text-white shadow-sm sm:px-8 sm:py-10">
            <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_center,rgba(111,211,4,0.20),transparent_68%)]" />
            <div className="relative max-w-3xl">
              <Badge className="border-white/15 bg-white/8 text-white" variant="outline">
                <Sparkles className="size-3 text-green-400" />
                {t("harnessMarketplace.curated")}
              </Badge>
              <h2 className="mt-5 text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
                {t("harnessMarketplace.title")}
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/65 sm:text-base sm:leading-7">
                {t("harnessMarketplace.subtitle")}
              </p>
              <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-white/70 sm:text-sm">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="size-3.5 text-green-400" />
                  {t("harnessMarketplace.oneKey")}
                </span>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-green-400" />
                  {t("harnessMarketplace.reproducible")}
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-green-400" />
                  {t("harnessMarketplace.oneLifecycle")}
                </span>
              </div>
            </div>
          </section>

          <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
            <section>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-accent-press text-xs font-semibold tracking-[0.12em] uppercase">
                    {t("harnessMarketplace.marketplace")}
                  </p>
                  <h2 className="text-foreground mt-1 text-xl font-semibold">
                    {t("harnessMarketplace.chooseHarness")}
                  </h2>
                </div>
                <span className="text-muted-foreground text-xs">
                  {t("harnessMarketplace.harnessCount", { count: String(HARNESSES.length) })}
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                {HARNESSES.map((harness) => (
                  <HarnessCard
                    harness={harness}
                    key={harness.slug}
                    onSelect={() => dispatch({ type: "harness", value: harness.slug })}
                    selected={harness.slug === state.selectedHarness}
                  />
                ))}
              </div>
            </section>

            <section className="border-border bg-card rounded-2xl border shadow-sm lg:sticky lg:top-0">
              <div className="border-border border-b px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-accent-press text-[11px] font-semibold tracking-[0.12em] uppercase">
                      {t("harnessMarketplace.quickRun")}
                    </p>
                    <h2 className="text-foreground mt-1 text-lg font-semibold">
                      {t("harnessMarketplace.runWith", {
                        harness: selectedHarness?.label ?? state.selectedHarness,
                      })}
                    </h2>
                  </div>
                  {selectedHarness ? (
                    <div className="border-border bg-bg-sunken flex size-10 items-center justify-center rounded-xl border">
                      <RuntimeIcon className="size-6" runtimeId={selectedHarness.runtimeId} />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-foreground text-xs font-semibold" htmlFor="run-api-key">
                      {t("harnessMarketplace.workspaceKey")}
                    </label>
                    <Link className="text-accent-press text-xs hover:underline" to="/api-keys">
                      {t("harnessMarketplace.manage")}
                    </Link>
                  </div>
                  <Input
                    autoComplete="off"
                    id="run-api-key"
                    onChange={(event) => dispatch({ type: "apiKey", value: event.target.value })}
                    placeholder="msk_…"
                    type="password"
                    value={state.apiKey}
                  />
                  {state.createdKey === null ? (
                    <Button
                      className="w-full"
                      disabled={createKeyMutation.isPending}
                      onClick={() => createKeyMutation.mutate()}
                      size="sm"
                      variant="tonal"
                    >
                      {createKeyMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <KeyRound className="size-4" />
                      )}
                      {t("harnessMarketplace.createKey")}
                    </Button>
                  ) : (
                    <button
                      className="border-success-fg/20 bg-success-bg text-success-fg flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs"
                      onClick={() => void copyCreatedKey()}
                      type="button"
                    >
                      <span className="min-w-0 truncate font-mono">{state.createdKey}</span>
                      {state.copied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  )}
                  {createKeyMutation.error instanceof Error ? (
                    <p className="text-destructive text-xs">{createKeyMutation.error.message}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <label className="text-foreground text-xs font-semibold" htmlFor="run-task">
                    {t("harnessMarketplace.task")}
                  </label>
                  <Textarea
                    className="bg-card min-h-28 resize-y text-sm"
                    id="run-task"
                    onChange={(event) => dispatch({ type: "task", value: event.target.value })}
                    placeholder={t("harnessMarketplace.taskPlaceholder")}
                    value={state.task}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    className="text-foreground text-xs font-semibold"
                    htmlFor="run-environment"
                  >
                    {t("harnessMarketplace.environment")}
                    <span className="text-muted-foreground ml-1 font-normal">
                      {t("harnessMarketplace.optional")}
                    </span>
                  </label>
                  <Input
                    id="run-environment"
                    onChange={(event) =>
                      dispatch({ type: "environment", value: event.target.value })
                    }
                    placeholder={t("harnessMarketplace.environmentPlaceholder")}
                    value={state.environment}
                  />
                  <p className="text-muted-foreground text-[11px]">
                    {t("harnessMarketplace.defaultEnvironment")}
                  </p>
                </div>

                <Button
                  className="h-10 w-full"
                  disabled={
                    state.apiKey.trim().length === 0 ||
                    state.task.trim().length === 0 ||
                    selectedHarness?.status !== "available" ||
                    runMutation.isPending
                  }
                  onClick={() => runMutation.mutate()}
                >
                  {runMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {runMutation.isPending
                    ? t("harnessMarketplace.starting")
                    : t("harnessMarketplace.runNow")}
                </Button>

                {runMutation.error instanceof Error ? (
                  <div className="bg-destructive/8 text-destructive rounded-md px-3 py-2 text-xs">
                    {runMutation.error.message}
                  </div>
                ) : null}
                {runMutation.data ? (
                  <div className="border-success-fg/20 bg-success-bg rounded-lg border p-3">
                    <p className="text-success-fg text-sm font-semibold">
                      {t("harnessMarketplace.runStarted")}
                    </p>
                    <p className="text-success-fg/80 mt-1 truncate font-mono text-[11px]">
                      {runMutation.data.id}
                    </p>
                    <Link
                      className="text-success-fg mt-2 inline-flex items-center gap-1 text-xs font-semibold hover:underline"
                      to={`/threads/${runMutation.data.threadId}`}
                    >
                      {t("harnessMarketplace.viewRun")}
                      <ArrowRight className="size-3" />
                    </Link>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <section className="border-border bg-bg-sunken mt-8 overflow-hidden rounded-xl border">
            <div className="border-border flex items-center justify-between border-b px-5 py-3">
              <span className="text-foreground text-xs font-semibold">
                {t("harnessMarketplace.quickstart")}
              </span>
              <Badge variant="outline">TypeScript</Badge>
            </div>
            <pre className="text-fg-2 overflow-x-auto p-5 text-xs leading-6 sm:text-sm">
              <code>{`const mosoo = new MosooClient({\n  token: process.env.MOSOO_WORKSPACE_API_KEY!,\n});\n\nconst run = await mosoo.run({\n  harness: "${state.selectedHarness}",\n  profile: "${selectedHarness?.defaultProfile ?? ""}",\n  input: "Review this repository",\n});`}</code>
            </pre>
          </section>

          <div className="border-border mt-6 flex items-center justify-between gap-4 rounded-xl border border-dashed px-5 py-4">
            <div>
              <p className="text-foreground text-sm font-semibold">
                {t("harnessMarketplace.agentsOptional")}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-5">
                {t("harnessMarketplace.agentsDescription")}
              </p>
            </div>
            <Button asChild className="shrink-0" size="sm" variant="ghost">
              <Link to="/agent">
                {t("harnessMarketplace.viewAgents")}
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function HarnessCard({
  harness,
  onSelect,
  selected,
}: {
  harness: HarnessCatalogEntry;
  onSelect: () => void;
  selected: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      aria-label={harness.label}
      aria-pressed={selected}
      className={`group w-full rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-accent-press/40 bg-accent-soft shadow-[0_0_0_1px_rgba(73,128,0,0.08)]"
          : "border-border bg-card hover:border-border-strong hover:shadow-xs"
      }`}
      disabled={harness.status !== "available"}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start gap-4">
        <div className="border-border bg-background flex size-11 shrink-0 items-center justify-center rounded-xl border shadow-xs">
          <RuntimeIcon className="size-7" runtimeId={harness.runtimeId} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-foreground text-sm font-semibold sm:text-base">{harness.label}</h3>
            <Badge variant={harness.status === "available" ? "success" : "outline"}>
              <span className="size-1.5 rounded-full bg-current" />
              {t(`harnessMarketplace.${harness.status}`)}
            </Badge>
            {selected ? <Badge variant="primary">{t("harnessMarketplace.selected")}</Badge> : null}
          </div>
          <p className="text-muted-foreground mt-1 text-xs leading-5 sm:text-[13px]">
            {harness.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="outline">{harness.slug}</Badge>
            <Badge variant="outline">{harness.defaultModel}</Badge>
            <Badge variant="outline">profile v{harness.profiles[0]?.version}</Badge>
          </div>
        </div>
        <span
          className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border ${
            selected ? "border-accent-press bg-accent-press text-white" : "border-border-strong"
          }`}
        >
          {selected ? <Check className="size-3" /> : null}
        </span>
      </div>
    </button>
  );
}
