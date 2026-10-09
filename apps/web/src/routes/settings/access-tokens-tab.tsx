import type { PersonalAccessTokenSummary } from "@mosoo/contracts/auth";
import type { ProjectId } from "@mosoo/id";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useActiveProject } from "@/app/session/session-context";
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  personalAccessTokenKeys,
  revokePersonalAccessToken,
} from "@/domains/auth/api/personal-access-token-client";
import { MOSOO_API_REFERENCE_URL } from "@/shared/config/external-links";
import { getCurrentLocale, useTranslation } from "@/shared/i18n";
import { writeClipboardText } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { CopyCheckIcon } from "@/shared/ui/copy-check-icon";
import { ExternalLink, KeyRound, Loader2, Plus, Trash2 } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";

import { isTruthy } from "../../shared/lib/truthiness";
import { SettingsTabBody, SettingsTabHeader } from "./settings-tab-layout";

function formatDateTime(value: string | null): string | null {
  if (!isTruthy(value)) {
    return null;
  }

  return new Date(value).toLocaleString(getCurrentLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AccessTokensTab() {
  const project = useActiveProject();
  return <ProjectAccessTokens key={project.id} projectId={project.id} />;
}

function ProjectAccessTokens({ projectId }: { projectId: ProjectId }) {
  const queryKey = personalAccessTokenKeys.list(projectId);
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const {
    data: tokensData,
    isLoading: tokensLoading,
    error: listError,
  } = useQuery({
    queryFn: () => listPersonalAccessTokens(projectId),
    queryKey: queryKey,
  });
  const createMutation = useMutation({
    mutationFn: (nextLabel: string) => createPersonalAccessToken(nextLabel, projectId),
    onSuccess: (response) => {
      setCreatedToken(response.value);
      setLabel("");
      void queryClient.invalidateQueries({ queryKey: queryKey });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: revokePersonalAccessToken,
    onSuccess: () => {
      setCreatedToken(null);
      setLabel("");
      void queryClient.invalidateQueries({ queryKey: queryKey });
    },
  });

  function handleCreate() {
    const normalized = label.trim();

    if (!normalized || createMutation.isPending) {
      return;
    }

    createMutation.mutate(normalized);
  }

  async function copyCreatedToken() {
    if (!isTruthy(createdToken) || !(await writeClipboardText(createdToken))) {
      return;
    }

    setCopied(true);
    globalThis.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <>
      <SettingsTabHeader
        title={t("settings.apiTokens")}
        actions={
          <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
            <a href={MOSOO_API_REFERENCE_URL} rel="noreferrer noopener" target="_blank">
              <ExternalLink className="size-3" />
              {t("agent.apiReference")}
            </a>
          </Button>
        }
      />
      <SettingsTabBody width="wide">
        <div className="space-y-5">
          <PersonalTokenSection
            copied={copied}
            createError={createMutation.error}
            createPending={createMutation.isPending}
            createdToken={createdToken}
            label={label}
            onChangeLabel={setLabel}
            onCopy={copyCreatedToken}
            onCreate={handleCreate}
          />

          {listError || revokeMutation.error ? (
            <p className="text-danger text-sm">{(listError ?? revokeMutation.error)?.message}</p>
          ) : null}
          <AccessTokensTable
            loading={tokensLoading}
            onRevoke={(tokenId) => {
              revokeMutation.mutate(tokenId);
            }}
            pending={revokeMutation.isPending}
            tokens={tokensData?.tokens ?? null}
          />
        </div>
      </SettingsTabBody>
    </>
  );
}

function PersonalTokenSection({
  copied,
  createError,
  createPending,
  createdToken,
  label,
  onChangeLabel,
  onCopy,
  onCreate,
}: {
  copied: boolean;
  createError: Error | null;
  createPending: boolean;
  createdToken: string | null;
  label: string;
  onChangeLabel: (label: string) => void;
  onCopy: () => Promise<void>;
  onCreate: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="border-border bg-card rounded-lg border p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="t-section-title flex items-center gap-2">
            <KeyRound className="text-fg-3 size-4" />
            {t("settings.apiTokens")}
          </div>
          <p className="text-fg-3 mt-1 max-w-2xl text-[12.5px] leading-relaxed">
            {t("settings.createTokenDescription")}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label={t("settings.tokenLabel")}
          onChange={(event) => {
            onChangeLabel(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onCreate();
            }
          }}
          placeholder={t("settings.tokenLabel")}
          value={label}
        />
        <Button
          className="gap-1.5"
          disabled={!label.trim() || createPending}
          onClick={onCreate}
          size="sm"
        >
          {createPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          {t("settings.createToken")}
        </Button>
      </div>

      {createError ? (
        <div className="border-danger/30 bg-danger/5 text-danger mt-3 rounded-md border px-3 py-2 text-[12px]">
          {createError.message}
        </div>
      ) : null}

      <CreatedTokenPanel copied={copied} onCopy={onCopy} token={createdToken} />
    </section>
  );
}

function CreatedTokenPanel({
  copied,
  onCopy,
  token,
}: {
  copied: boolean;
  onCopy: () => Promise<void>;
  token: string | null;
}) {
  const { t } = useTranslation();

  if (!isTruthy(token)) {
    return null;
  }

  return (
    <div className="border-brand/25 bg-selected mt-4 rounded-md border p-3">
      <div className="text-foreground text-[12px] font-medium">{t("settings.newAccessToken")}</div>
      <p className="text-fg-3 mt-1 text-[11.5px]">{t("settings.copyTokenWarning")}</p>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <code className="border-border-soft text-foreground bg-card min-w-0 flex-1 truncate rounded border px-2.5 py-1.5 text-[12px]">
          {token}
        </code>
        <Button
          aria-label={t("settings.copyToken")}
          onClick={() => {
            void onCopy();
          }}
          size="icon-xs"
          title={t("settings.copyToken")}
          variant="outline"
        >
          <CopyCheckIcon copied={copied} />
        </Button>
      </div>
    </div>
  );
}

function AccessTokensTable({
  loading,
  onRevoke,
  pending,
  tokens,
}: {
  loading: boolean;
  onRevoke: (tokenId: PersonalAccessTokenSummary["id"]) => void;
  pending: boolean;
  tokens: PersonalAccessTokenSummary[] | null;
}) {
  const { t } = useTranslation();
  const emptyState = loading
    ? t("settings.loadingTokens")
    : tokens?.length === 0
      ? t("settings.noTokensYet")
      : null;

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border xl:overflow-x-auto">
      <div className="xl:hidden">
        {emptyState === null ? null : (
          <div className="text-fg-3 px-4 py-8 text-sm">{emptyState}</div>
        )}
        {tokens?.map((token) => (
          <div className="border-border border-b p-4 last:border-b-0" key={token.id}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-foreground truncate text-sm font-medium">{token.label}</div>
                <div className="text-fg-3 mt-1 text-xs">
                  {t("settings.createdAt", {
                    date: formatDateTime(token.createdAt) ?? t("settings.never"),
                  })}
                </div>
              </div>
              <Button
                aria-label={t("settings.revokeToken")}
                className="min-h-10 min-w-10 shrink-0"
                disabled={pending || token.revokedAt !== null}
                onClick={() => {
                  onRevoke(token.id);
                }}
                size="icon-xs"
                title={t("settings.revokeToken")}
                variant="ghost"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <dl className="mt-3 grid gap-2 text-xs">
              <div>
                <dt className="text-fg-3">{t("settings.tokenId")}</dt>
                <dd className="text-foreground mt-0.5 font-mono break-all">{token.id}</dd>
              </div>
              <div>
                <dt className="text-fg-3">{t("settings.lastUsed")}</dt>
                <dd className="text-foreground mt-0.5">
                  {formatDateTime(token.lastUsedAt) ?? t("settings.never")}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="hidden min-w-[560px] xl:block">
        <div className="border-border text-fg-2 grid grid-cols-[minmax(180px,1fr)_140px_160px_64px] border-b px-4 py-2.5 text-[12px] leading-4 font-medium">
          <div>{t("settings.label")}</div>
          <div>{t("settings.tokenId")}</div>
          <div>{t("settings.lastUsed")}</div>
          <div className="text-right">{t("settings.action")}</div>
        </div>

        {emptyState === null ? null : (
          <div className="text-fg-3 px-4 py-8 text-sm">{emptyState}</div>
        )}

        {tokens?.map((token) => (
          <AccessTokenRow
            key={token.id}
            onRevoke={() => {
              onRevoke(token.id);
            }}
            pending={pending}
            token={token}
          />
        ))}
      </div>
    </section>
  );
}

function AccessTokenRow({
  onRevoke,
  pending,
  token,
}: {
  onRevoke: () => void;
  pending: boolean;
  token: PersonalAccessTokenSummary;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-slot="data-row"
      className="border-border-soft hover:bg-hover grid min-h-10 grid-cols-[minmax(180px,1fr)_140px_160px_64px] items-center border-b px-4 py-2 text-[13px] transition-[background-color] duration-150 ease-out last:border-b-0"
    >
      <div className="min-w-0">
        <div className="text-fg-1 truncate font-medium">{token.label}</div>
        <div className="text-fg-3 mt-0.5 text-[12px] leading-4">
          {t("settings.createdAt", {
            date: formatDateTime(token.createdAt) ?? t("settings.never"),
          })}
        </div>
      </div>
      <code data-slot="mono" className="text-fg-3 truncate font-mono text-[12px] tabular-nums">
        {token.id}
      </code>
      <div className="text-fg-3 text-[12px]">
        {formatDateTime(token.lastUsedAt) ?? t("settings.never")}
      </div>
      <div className="flex justify-end">
        <Button
          aria-label={t("settings.revokeToken")}
          disabled={pending || token.revokedAt !== null}
          onClick={onRevoke}
          size="icon-xs"
          title={t("settings.revokeToken")}
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
