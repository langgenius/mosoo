import type {
  OrganizationServiceTokenSummary,
  PersonalAccessTokenSummary,
} from "@mosoo/contracts/auth";
import { Permission, can } from "@mosoo/contracts/permission";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useReducer } from "react";

import { useAppSession } from "@/app/session-provider";
import {
  createOrganizationServiceToken,
  createPersonalAccessToken,
  listPersonalAccessTokens,
  listOrganizationServiceTokens,
  revokeOrganizationServiceToken,
  revokePersonalAccessToken,
} from "@/domains/auth/api/personal-access-token-client";
import { toAgentId, toOrganizationId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";

import { isTruthy } from "../../shared/lib/truthiness";
const ACCESS_TOKEN_QUERY_KEY = ["auth", "personal-access-tokens"] as const;
const SERVICE_TOKEN_QUERY_KEY = ["auth", "organization-service-tokens"] as const;

interface AccessTokensState {
  copied: boolean;
  createdServiceToken: string | null;
  createdToken: string | null;
  label: string;
  serviceAgentIds: string;
  serviceAllowAttribution: boolean;
  serviceCopied: boolean;
  serviceLabel: string;
}

type AccessTokensAction =
  | { type: "changeLabel"; label: string }
  | { type: "changeServiceAgentIds"; value: string }
  | { type: "changeServiceAllowAttribution"; value: boolean }
  | { type: "changeServiceLabel"; label: string }
  | { type: "createdServiceToken"; token: string }
  | { type: "createdToken"; token: string }
  | { type: "setCopied"; copied: boolean }
  | { type: "setServiceCopied"; copied: boolean };

const ACCESS_TOKENS_INITIAL_STATE: AccessTokensState = {
  copied: false,
  createdServiceToken: null,
  createdToken: null,
  label: "",
  serviceAgentIds: "",
  serviceAllowAttribution: false,
  serviceCopied: false,
  serviceLabel: "",
};

function accessTokensReducer(
  state: AccessTokensState,
  action: AccessTokensAction,
): AccessTokensState {
  switch (action.type) {
    case "changeLabel":
      return { ...state, label: action.label };
    case "changeServiceAgentIds":
      return { ...state, serviceAgentIds: action.value };
    case "changeServiceAllowAttribution":
      return { ...state, serviceAllowAttribution: action.value };
    case "changeServiceLabel":
      return { ...state, serviceLabel: action.label };
    case "createdServiceToken":
      return {
        ...state,
        createdServiceToken: action.token,
        serviceAgentIds: "",
        serviceAllowAttribution: false,
        serviceLabel: "",
      };
    case "createdToken":
      return { ...state, createdToken: action.token, label: "" };
    case "setCopied":
      return { ...state, copied: action.copied };
    case "setServiceCopied":
      return { ...state, serviceCopied: action.copied };
  }
}

function formatDateTime(value: string | null): string {
  if (!isTruthy(value)) {
    return "Never";
  }

  return new Date(value).toLocaleString(undefined, {
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
  const { activeOrganization } = useAppSession();
  const [state, dispatch] = useReducer(accessTokensReducer, ACCESS_TOKENS_INITIAL_STATE);
  const {
    copied,
    createdServiceToken,
    createdToken,
    label,
    serviceAgentIds,
    serviceAllowAttribution,
    serviceCopied,
    serviceLabel,
  } = state;
  const organizationId = activeOrganization?.id ?? null;
  const canManageServiceTokens = can(
    activeOrganization?.viewerRole,
    Permission.OrganizationServiceTokensManage,
  );
  const tokensQuery = useQuery({
    queryFn: listPersonalAccessTokens,
    queryKey: ACCESS_TOKEN_QUERY_KEY,
  });
  const serviceTokensQuery = useQuery({
    enabled: organizationId !== null && canManageServiceTokens,
    queryFn: async () => {
      if (organizationId === null) {
        throw new Error("Organization is required.");
      }

      return listOrganizationServiceTokens(toOrganizationId(organizationId));
    },
    queryKey: [...SERVICE_TOKEN_QUERY_KEY, organizationId],
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
  const createServiceMutation = useMutation({
    mutationFn: createOrganizationServiceToken,
    onSuccess: (response) => {
      dispatch({ token: response.value, type: "createdServiceToken" });
      void queryClient.invalidateQueries({ queryKey: SERVICE_TOKEN_QUERY_KEY });
    },
  });
  const revokeServiceMutation = useMutation({
    mutationFn: revokeOrganizationServiceToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICE_TOKEN_QUERY_KEY });
    },
  });
  const serviceTokenHasAgents = readSelectedAgentIds().length > 0;

  function handleCreate() {
    const normalized = label.trim();

    if (!normalized || createMutation.isPending) {
      return;
    }

    createMutation.mutate(normalized);
  }

  function readSelectedAgentIds(): string[] {
    return serviceAgentIds
      .split(",")
      .map((agentId) => agentId.trim())
      .filter((agentId) => agentId !== "");
  }

  function handleCreateServiceToken() {
    const normalized = serviceLabel.trim();
    const allowedAgentIds = readSelectedAgentIds();

    if (
      !normalized ||
      allowedAgentIds.length === 0 ||
      organizationId === null ||
      createServiceMutation.isPending
    ) {
      return;
    }

    createServiceMutation.mutate({
      allowAttribution: serviceAllowAttribution,
      allowedAgentIds: allowedAgentIds.map(toAgentId),
      label: normalized,
      organizationId: toOrganizationId(organizationId),
    });
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

  async function copyCreatedServiceToken() {
    if (!isTruthy(createdServiceToken)) {
      return;
    }

    const didCopy = await writeCreatedTokenToClipboard(createdServiceToken);
    if (!didCopy) {
      return;
    }

    dispatch({ copied: true, type: "setServiceCopied" });
    globalThis.setTimeout(() => {
      dispatch({ copied: false, type: "setServiceCopied" });
    }, 1500);
  }

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center border-b px-5">
        <span className="text-sm font-medium">Access Tokens</span>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          <AgentAccessTokenSection
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

          {canManageServiceTokens ? (
            <OrganizationServiceTokenSection
              canCreateToken={
                serviceLabel.trim().length > 0 &&
                serviceTokenHasAgents &&
                !createServiceMutation.isPending
              }
              copied={serviceCopied}
              createError={createServiceMutation.error}
              createdToken={createdServiceToken}
              onChangeAgentIds={(value) => {
                dispatch({ type: "changeServiceAgentIds", value });
              }}
              onChangeAllowAttribution={(value) => {
                dispatch({ type: "changeServiceAllowAttribution", value });
              }}
              onChangeLabel={(nextLabel) => {
                dispatch({ label: nextLabel, type: "changeServiceLabel" });
              }}
              onCopy={copyCreatedServiceToken}
              onCreate={handleCreateServiceToken}
              pending={createServiceMutation.isPending}
              serviceAgentIds={serviceAgentIds}
              serviceAllowAttribution={serviceAllowAttribution}
              serviceLabel={serviceLabel}
            />
          ) : null}

          {canManageServiceTokens ? (
            <OrganizationServiceTokensTable
              loading={serviceTokensQuery.isLoading}
              onRevoke={(tokenId) => {
                revokeServiceMutation.mutate(tokenId);
              }}
              pending={revokeServiceMutation.isPending}
              tokens={serviceTokensQuery.data?.tokens ?? null}
            />
          ) : null}

          <AccessTokensTable
            loading={tokensQuery.isLoading}
            onRevoke={(tokenId) => {
              revokeMutation.mutate(tokenId);
            }}
            pending={revokeMutation.isPending}
            tokens={tokensQuery.data?.tokens ?? null}
          />
        </div>
      </div>
    </>
  );
}

function AgentAccessTokenSection({
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
            Agent API Tokens
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-[12.5px] leading-relaxed">
            Long-lived caller identity tokens for CI/CD, server-to-server calls, curl, and
            integrations. Access still comes from organization membership and Agent access mode.
            Revoked tokens fail on the next request.
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
        title="New token"
        token={createdToken}
        tooltip="Copy token"
      />
    </section>
  );
}

function OrganizationServiceTokenSection({
  canCreateToken,
  copied,
  createError,
  createdToken,
  onChangeAgentIds,
  onChangeAllowAttribution,
  onChangeLabel,
  onCopy,
  onCreate,
  pending,
  serviceAgentIds,
  serviceAllowAttribution,
  serviceLabel,
}: {
  canCreateToken: boolean;
  copied: boolean;
  createError: Error | null;
  createdToken: string | null;
  onChangeAgentIds: (value: string) => void;
  onChangeAllowAttribution: (value: boolean) => void;
  onChangeLabel: (label: string) => void;
  onCopy: () => Promise<void>;
  onCreate: () => void;
  pending: boolean;
  serviceAgentIds: string;
  serviceAllowAttribution: boolean;
  serviceLabel: string;
}) {
  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <KeyRound className="text-fg-3 size-4" />
            Organization Service Tokens
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-[12.5px] leading-relaxed">
            Machine caller identity for customer backends, Managed CLI, and server jobs. Each token
            must select published Agents explicitly; it never defaults to all Agents and is not a
            Channel binding credential.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1.2fr)_auto]">
        <Input
          aria-label="Service token label"
          onChange={(event) => {
            onChangeLabel(event.target.value);
          }}
          placeholder="Service token label"
          value={serviceLabel}
        />
        <Input
          aria-label="Allowed Agent IDs"
          onChange={(event) => {
            onChangeAgentIds(event.target.value);
          }}
          placeholder="Allowed Agent IDs, comma-separated"
          value={serviceAgentIds}
        />
        <Button className="gap-1.5" disabled={!canCreateToken} onClick={onCreate} size="sm">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Create
        </Button>
      </div>

      <div className="text-muted-foreground mt-3 flex items-center gap-2 text-[12.5px]">
        <Switch
          aria-label="Allow attributed_user_id projection"
          checked={serviceAllowAttribution}
          onCheckedChange={onChangeAllowAttribution}
        />
        <span>Allow attributed_user_id projection</span>
      </div>

      {createError ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive mt-3 rounded-md border px-3 py-2 text-[12px]">
          {createError.message}
        </div>
      ) : null}

      <CreatedTokenPanel
        copied={copied}
        onCopy={onCopy}
        title="New service token"
        token={createdToken}
        tooltip="Copy service token"
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
          onClick={() => {
            void onCopy();
          }}
          size="icon-xs"
          title={tooltip}
          variant="outline"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function OrganizationServiceTokensTable({
  loading,
  onRevoke,
  pending,
  tokens,
}: {
  loading: boolean;
  onRevoke: (tokenId: OrganizationServiceTokenSummary["id"]) => void;
  pending: boolean;
  tokens: OrganizationServiceTokenSummary[] | null;
}) {
  return (
    <section className="border-border bg-card overflow-x-auto rounded-lg border">
      <div className="min-w-[720px]">
        <div className="border-border text-muted-foreground grid grid-cols-[minmax(160px,1fr)_140px_180px_110px_64px] border-b px-4 py-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
          <div>Label</div>
          <div>Token ID</div>
          <div>Allowed Agents</div>
          <div>Attribution</div>
          <div className="text-right">Action</div>
        </div>

        {loading ? (
          <div className="text-muted-foreground px-4 py-6 text-sm">Loading service tokens…</div>
        ) : null}

        {tokens?.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-sm">No service tokens yet.</div>
        ) : null}

        {tokens?.map((token) => (
          <OrganizationServiceTokenRow
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
  return (
    <section className="border-border bg-card overflow-x-auto rounded-lg border">
      <div className="min-w-[560px]">
        <div className="border-border text-muted-foreground grid grid-cols-[minmax(180px,1fr)_140px_160px_64px] border-b px-4 py-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
          <div>Label</div>
          <div>Token ID</div>
          <div>Last Used</div>
          <div className="text-right">Action</div>
        </div>

        {loading ? (
          <div className="text-muted-foreground px-4 py-6 text-sm">Loading tokens…</div>
        ) : null}

        {tokens?.length === 0 ? (
          <div className="text-muted-foreground px-4 py-8 text-sm">No tokens yet.</div>
        ) : null}

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

function OrganizationServiceTokenRow({
  onRevoke,
  pending,
  token,
}: {
  onRevoke: () => void;
  pending: boolean;
  token: OrganizationServiceTokenSummary;
}) {
  return (
    <div className="border-border grid grid-cols-[minmax(160px,1fr)_140px_180px_110px_64px] items-center border-b px-4 py-3 text-sm last:border-b-0">
      <div className="min-w-0">
        <div className="text-foreground truncate font-medium">{token.label}</div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          Created {formatDateTime(token.createdAt)}
        </div>
      </div>
      <code className="text-muted-foreground truncate text-xs">{token.id}</code>
      <div className="text-muted-foreground truncate text-xs">
        {token.allowedAgentIds.join(", ")}
      </div>
      <div className="text-muted-foreground text-xs">
        {token.allowAttribution ? "Allowed" : "Off"}
      </div>
      <div className="flex justify-end">
        <Button
          disabled={pending || token.revokedAt !== null}
          onClick={onRevoke}
          size="icon-xs"
          title="Revoke service token"
          variant="ghost"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
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
