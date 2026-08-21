import type { WorkspaceApiKeySummary } from "@mosoo/contracts/auth";
import type { WorkspaceApiKeyId } from "@mosoo/contracts/id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useReducer } from "react";

import { useAppSession } from "@/app/session-provider";
import {
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
  revokeWorkspaceApiKey,
} from "@/domains/auth/api/workspace-api-key-client";
import { getCurrentLocale, useTranslation } from "@/shared/i18n";
import { writeClipboardText } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

interface PageState {
  copied: boolean;
  createdValue: string | null;
  label: string;
}

type PageAction =
  | { type: "copied"; value: boolean }
  | { type: "created"; value: string }
  | { type: "label"; value: string };

const INITIAL_STATE: PageState = { copied: false, createdValue: null, label: "" };

function reducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case "copied":
      return { ...state, copied: action.value };
    case "created":
      return { ...state, createdValue: action.value, label: "" };
    case "label":
      return { ...state, label: action.value };
  }
}

function formatDate(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString(getCurrentLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function WorkspaceApiKeysPage() {
  const { activeApp, appsLoading } = useAppSession();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const queryKey = ["auth", "workspace-api-keys", activeApp?.id ?? null] as const;
  const keysQuery = useQuery({
    enabled: activeApp !== null,
    queryFn: async () => listWorkspaceApiKeys(activeApp!.id),
    queryKey,
  });
  const createMutation = useMutation({
    mutationFn: async (label: string) => {
      if (activeApp === null) throw new Error(t("common.noApp"));
      return createWorkspaceApiKey(activeApp.id, label);
    },
    onSuccess: (response) => {
      dispatch({ type: "created", value: response.value });
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: async (keyId: WorkspaceApiKeyId) => {
      if (activeApp === null) throw new Error(t("common.noApp"));
      await revokeWorkspaceApiKey(activeApp.id, keyId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (activeApp === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? t("common.loadingApp") : t("common.noApp")}
      </div>
    );
  }

  const create = () => {
    const label = state.label.trim();
    if (label.length > 0 && !createMutation.isPending) createMutation.mutate(label);
  };

  const copy = async () => {
    if (state.createdValue === null || !(await writeClipboardText(state.createdValue))) return;
    dispatch({ type: "copied", value: true });
    globalThis.setTimeout(() => dispatch({ type: "copied", value: false }), 1500);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background shrink-0 border-b px-4 py-5 sm:px-6 lg:px-8">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase">
          <KeyRound className="size-3.5" />
          {t("workspaceKeys.eyebrow")}
        </div>
        <h1 className="text-foreground mt-1 text-2xl font-semibold tracking-tight">
          {t("workspaceKeys.title")}
        </h1>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          {t("workspaceKeys.subtitle")}
        </p>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <section className="border-border bg-card rounded-xl border p-5 shadow-xs">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                aria-label={t("workspaceKeys.label")}
                onChange={(event) => dispatch({ type: "label", value: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") create();
                }}
                placeholder={t("workspaceKeys.labelPlaceholder")}
                value={state.label}
              />
              <Button
                disabled={state.label.trim().length === 0 || createMutation.isPending}
                onClick={create}
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {t("workspaceKeys.create")}
              </Button>
            </div>

            {createMutation.error instanceof Error ? (
              <p className="text-destructive mt-3 text-xs">{createMutation.error.message}</p>
            ) : null}

            {state.createdValue === null ? null : (
              <div className="border-success-fg/20 bg-success-bg mt-4 rounded-lg border p-4">
                <p className="text-success-fg text-xs font-semibold">
                  {t("workspaceKeys.copyWarning")}
                </p>
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <code className="border-border bg-card text-foreground min-w-0 flex-1 overflow-x-auto rounded-md border px-3 py-2 text-xs">
                    {state.createdValue}
                  </code>
                  <Button
                    aria-label={t("common.copy")}
                    onClick={() => void copy()}
                    variant="outline"
                  >
                    {state.copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="border-border bg-card overflow-hidden rounded-xl border shadow-xs">
            <div className="border-border flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-foreground text-sm font-semibold">
                  {t("workspaceKeys.active")}
                </h2>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("workspaceKeys.activeDescription")}
                </p>
              </div>
              <span className="bg-secondary text-fg-2 rounded-md px-2 py-1 text-xs font-semibold">
                {(keysQuery.data?.keys ?? []).filter((key) => key.revokedAt === null).length}
              </span>
            </div>

            {keysQuery.isLoading ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 px-5 py-12 text-sm">
                <Loader2 className="size-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : keysQuery.error instanceof Error ? (
              <p className="text-destructive px-5 py-6 text-sm">{keysQuery.error.message}</p>
            ) : (keysQuery.data?.keys.length ?? 0) === 0 ? (
              <p className="text-muted-foreground px-5 py-12 text-center text-sm">
                {t("workspaceKeys.empty")}
              </p>
            ) : (
              <div className="divide-border divide-y">
                {(keysQuery.data?.keys ?? []).map((key) => (
                  <KeyRow
                    key={key.id}
                    item={key}
                    pending={revokeMutation.isPending}
                    onRevoke={(id) => revokeMutation.mutate(id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function KeyRow({
  item,
  onRevoke,
  pending,
}: {
  item: WorkspaceApiKeySummary;
  onRevoke: (id: WorkspaceApiKeyId) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="bg-bg-sunken border-border flex size-9 shrink-0 items-center justify-center rounded-lg border">
        <KeyRound className="text-fg-3 size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">{item.label}</span>
          {item.revokedAt === null ? null : (
            <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
              {t("workspaceKeys.revoked")}
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t("workspaceKeys.created", { date: formatDate(item.createdAt) })} ·{" "}
          {t("workspaceKeys.lastUsed", { date: formatDate(item.lastUsedAt) })}
        </p>
      </div>
      {item.revokedAt === null ? (
        <Button
          aria-label={t("workspaceKeys.revoke")}
          disabled={pending}
          onClick={() => onRevoke(item.id)}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 className="text-destructive size-4" />
        </Button>
      ) : null}
    </div>
  );
}
