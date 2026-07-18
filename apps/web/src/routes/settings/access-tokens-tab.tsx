import type { PersonalAccessTokenSummary } from "@mosoo/contracts/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useReducer } from "react";

import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "@/domains/auth/api/personal-access-token-client";
import { MOSOO_API_REFERENCE_URL } from "@/shared/config/external-links";
import { Button } from "@/shared/ui/button";
import { CopyCheckIcon } from "@/shared/ui/copy-check-icon";
import { Input } from "@/shared/ui/input";

import { isTruthy } from "../../shared/lib/truthiness";
import { SettingsTabBody, SettingsTabHeader } from "./settings-tab-layout";

const ACCESS_TOKEN_QUERY_KEY = ["auth", "personal-access-tokens"] as const;

interface AccessTokensState {
  copied: boolean;
  createdToken: string | null;
  label: string;
}

type AccessTokensAction =
  | { type: "changeLabel"; label: string }
  | { type: "createdToken"; token: string }
  | { type: "setCopied"; copied: boolean };

const ACCESS_TOKENS_INITIAL_STATE: AccessTokensState = {
  copied: false,
  createdToken: null,
  label: "",
};

function accessTokensReducer(
  state: AccessTokensState,
  action: AccessTokensAction,
): AccessTokensState {
  switch (action.type) {
    case "changeLabel":
      return { ...state, label: action.label };
    case "createdToken":
      return { ...state, createdToken: action.token, label: "" };
    case "setCopied":
      return { ...state, copied: action.copied };
  }
}

function formatDateTime(value: string | null): string {
  if (!isTruthy(value)) {
    return "Never";
  }

  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function writeCreatedTokenToClipboard(token: string): Promise<boolean> {
  if (!navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(token);
    return true;
  } catch {
    return false;
  }
}

export function AccessTokensTab() {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(accessTokensReducer, ACCESS_TOKENS_INITIAL_STATE);
  const { copied, createdToken, label } = state;
  const { data: tokensData, isLoading: tokensLoading } = useQuery({
    queryFn: listPersonalAccessTokens,
    queryKey: ACCESS_TOKEN_QUERY_KEY,
  });
  const createMutation = useMutation({
    mutationFn: createPersonalAccessToken,
    onSuccess: (response) => {
      dispatch({ token: response.value, type: "createdToken" });
      void queryClient.invalidateQueries({ queryKey: ACCESS_TOKEN_QUERY_KEY });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: revokePersonalAccessToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCESS_TOKEN_QUERY_KEY });
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
    if (!isTruthy(createdToken)) {
      return;
    }

    const didCopy = await writeCreatedTokenToClipboard(createdToken);
    if (!didCopy) {
      return;
    }

    dispatch({ copied: true, type: "setCopied" });
    globalThis.setTimeout(() => {
      dispatch({ copied: false, type: "setCopied" });
    }, 1500);
  }

  return (
    <>
      <SettingsTabHeader
        title="API Tokens"
        actions={
          <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
            <a href={MOSOO_API_REFERENCE_URL} rel="noreferrer noopener" target="_blank">
              <ExternalLink className="size-3" />
              API reference
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
            onChangeLabel={(nextLabel) => {
              dispatch({ label: nextLabel, type: "changeLabel" });
            }}
            onCopy={copyCreatedToken}
            onCreate={handleCreate}
          />

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
  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="text-fg-3 size-4" />
            API Tokens
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-[12.5px] leading-relaxed">
            Create API tokens to call Agent API endpoints. Requests are tied to your account.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Token label"
          onChange={(event) => {
            onChangeLabel(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onCreate();
            }
          }}
          placeholder="Token label"
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
          Create
        </Button>
      </div>

      {createError ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive mt-3 rounded-md border px-3 py-2 text-[12px]">
          {createError.message}
        </div>
      ) : null}

      <CreatedTokenPanel
        copied={copied}
        onCopy={onCopy}
        title="New access token"
        token={createdToken}
        tooltip="Copy token"
      />
    </section>
  );
}

function CreatedTokenPanel({
  copied,
  onCopy,
  title,
  token,
  tooltip,
}: {
  copied: boolean;
  onCopy: () => Promise<void>;
  title: string;
  token: string | null;
  tooltip: string;
}) {
  if (!isTruthy(token)) {
    return null;
  }

  return (
    <div className="border-brand/25 bg-brand-light mt-4 rounded-md border p-3">
      <div className="text-foreground text-[12px] font-medium">{title}</div>
      <p className="text-muted-foreground mt-1 text-[11.5px]">
        Copy this token now. It will not be shown again.
      </p>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        <code className="border-border-subtle text-foreground min-w-0 flex-1 truncate rounded border bg-white px-2.5 py-1.5 text-[12px]">
          {token}
        </code>
        <Button
          aria-label={tooltip}
          onClick={() => {
            void onCopy();
          }}
          size="icon-xs"
          title={tooltip}
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
  const emptyState = loading ? "Loading tokens..." : tokens?.length === 0 ? "No tokens yet." : null;

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border xl:overflow-x-auto">
      <div className="xl:hidden">
        {emptyState === null ? null : (
          <div className="text-muted-foreground px-4 py-8 text-sm">{emptyState}</div>
        )}
        {tokens?.map((token) => (
          <div className="border-border border-b p-4 last:border-b-0" key={token.id}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-foreground truncate text-sm font-medium">{token.label}</div>
                <div className="text-muted-foreground mt-1 text-xs">
                  Created {formatDateTime(token.createdAt)}
                </div>
              </div>
              <Button
                aria-label="Revoke token"
                className="min-h-10 min-w-10 shrink-0"
                disabled={pending || token.revokedAt !== null}
                onClick={() => {
                  onRevoke(token.id);
                }}
                size="icon-xs"
                title="Revoke token"
                variant="ghost"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <dl className="mt-3 grid gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Token ID</dt>
                <dd className="text-foreground mt-0.5 font-mono break-all">{token.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last used</dt>
                <dd className="text-foreground mt-0.5">{formatDateTime(token.lastUsedAt)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="hidden min-w-[560px] xl:block">
        <div className="border-border text-muted-foreground grid grid-cols-[minmax(180px,1fr)_140px_160px_64px] border-b px-4 py-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
          <div>Label</div>
          <div>Token ID</div>
          <div>Last Used</div>
          <div className="text-right">Action</div>
        </div>

        {emptyState === null ? null : (
          <div className="text-muted-foreground px-4 py-8 text-sm">{emptyState}</div>
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
  return (
    <div className="border-border grid grid-cols-[minmax(180px,1fr)_140px_160px_64px] items-center border-b px-4 py-3 text-sm last:border-b-0">
      <div className="min-w-0">
        <div className="text-foreground truncate font-medium">{token.label}</div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          Created {formatDateTime(token.createdAt)}
        </div>
      </div>
      <code className="text-muted-foreground truncate text-xs">{token.id}</code>
      <div className="text-muted-foreground text-xs">{formatDateTime(token.lastUsedAt)}</div>
      <div className="flex justify-end">
        <Button
          aria-label="Revoke token"
          disabled={pending || token.revokedAt !== null}
          onClick={onRevoke}
          size="icon-xs"
          title="Revoke token"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
