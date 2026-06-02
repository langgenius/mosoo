import type {
  OrganizationServiceTokenSummary,
  PersonalAccessTokenSummary,
} from "@mosoo/contracts/auth";
import { Permission, can } from "@mosoo/contracts/permission";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

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
  const [label, setLabel] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [serviceLabel, setServiceLabel] = useState("");
  const [serviceAgentIds, setServiceAgentIds] = useState("");
  const [serviceAllowAttribution, setServiceAllowAttribution] = useState(false);
  const [createdServiceToken, setCreatedServiceToken] = useState<string | null>(null);
  const [serviceCopied, setServiceCopied] = useState(false);
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
      setCreatedToken(response.value);
      setLabel("");
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
      setCreatedServiceToken(response.value);
      setServiceLabel("");
      setServiceAgentIds("");
      setServiceAllowAttribution(false);
      void queryClient.invalidateQueries({ queryKey: SERVICE_TOKEN_QUERY_KEY });
    },
  });
  const revokeServiceMutation = useMutation({
    mutationFn: revokeOrganizationServiceToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICE_TOKEN_QUERY_KEY });
    },
  });

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

    setCopied(true);
    globalThis.setTimeout(() => {
      setCopied(false);
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

    setServiceCopied(true);
    globalThis.setTimeout(() => {
      setServiceCopied(false);
    }, 1500);
  }

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center border-b px-5">
        <span className="text-sm font-medium">Access Tokens</span>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          <section className="border-border bg-card rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="text-fg-3 size-4" />
                  Agent API Tokens
                </div>
                <p className="text-muted-foreground mt-1 max-w-2xl text-[12.5px] leading-relaxed">
                  Long-lived caller identity tokens for CI/CD, server-to-server calls, curl, and
                  integrations. Access still comes from organization membership and Agent access
                  mode. Revoked tokens fail on the next request.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Token label"
                onChange={(event) => {
                  setLabel(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleCreate();
                  }
                }}
                placeholder="Token label"
                value={label}
              />
              <Button
                className="gap-1.5"
                disabled={!label.trim() || createMutation.isPending}
                onClick={handleCreate}
                size="sm"
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Create
              </Button>
            </div>

            {createMutation.error ? (
              <div className="border-destructive/30 bg-destructive/5 text-destructive mt-3 rounded-md border px-3 py-2 text-[12px]">
                {createMutation.error.message}
              </div>
            ) : null}

            {isTruthy(createdToken) ? (
              <div className="border-brand/25 bg-brand-light mt-4 rounded-md border p-3">
                <div className="text-foreground text-[12px] font-medium">New token</div>
                <p className="text-muted-foreground mt-1 text-[11.5px]">
                  Copy this token now. It will not be shown again.
                </p>
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <code className="border-border-subtle text-foreground min-w-0 flex-1 truncate rounded border bg-white px-2.5 py-1.5 text-[12px]">
                    {createdToken}
                  </code>
                  <Button
                    onClick={copyCreatedToken}
                    size="icon-xs"
                    title="Copy token"
                    variant="outline"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {canManageServiceTokens ? (
            <section className="border-border bg-card rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
                    <KeyRound className="text-fg-3 size-4" />
                    Organization Service Tokens
                  </div>
                  <p className="text-muted-foreground mt-1 max-w-2xl text-[12.5px] leading-relaxed">
                    Machine caller identity for customer backends, Managed CLI, and server jobs.
                    Each token must select published Agents explicitly; it never defaults to all
                    Agents and is not a Channel binding credential.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1.2fr)_auto]">
                <Input
                  aria-label="Service token label"
                  onChange={(event) => {
                    setServiceLabel(event.target.value);
                  }}
                  placeholder="Service token label"
                  value={serviceLabel}
                />
                <Input
                  aria-label="Allowed Agent IDs"
                  onChange={(event) => {
                    setServiceAgentIds(event.target.value);
                  }}
                  placeholder="Allowed Agent IDs, comma-separated"
                  value={serviceAgentIds}
                />
                <Button
                  className="gap-1.5"
                  disabled={
                    !serviceLabel.trim() ||
                    readSelectedAgentIds().length === 0 ||
                    createServiceMutation.isPending
                  }
                  onClick={handleCreateServiceToken}
                  size="sm"
                >
                  {createServiceMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Create
                </Button>
              </div>

              <div className="text-muted-foreground mt-3 flex items-center gap-2 text-[12.5px]">
                <Switch
                  aria-label="Allow attributed_user_id projection"
                  checked={serviceAllowAttribution}
                  onCheckedChange={setServiceAllowAttribution}
                />
                <span>Allow attributed_user_id projection</span>
              </div>

              {createServiceMutation.error ? (
                <div className="border-destructive/30 bg-destructive/5 text-destructive mt-3 rounded-md border px-3 py-2 text-[12px]">
                  {createServiceMutation.error.message}
                </div>
              ) : null}

              {isTruthy(createdServiceToken) ? (
                <div className="border-brand/25 bg-brand-light mt-4 rounded-md border p-3">
                  <div className="text-foreground text-[12px] font-medium">New service token</div>
                  <p className="text-muted-foreground mt-1 text-[11.5px]">
                    Copy this token now. It will not be shown again.
                  </p>
                  <div className="mt-2 flex min-w-0 items-center gap-2">
                    <code className="border-border-subtle text-foreground min-w-0 flex-1 truncate rounded border bg-white px-2.5 py-1.5 text-[12px]">
                      {createdServiceToken}
                    </code>
                    <Button
                      onClick={copyCreatedServiceToken}
                      size="icon-xs"
                      title="Copy service token"
                      variant="outline"
                    >
                      {serviceCopied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {canManageServiceTokens ? (
            <section className="border-border bg-card overflow-x-auto rounded-lg border">
              <div className="min-w-[720px]">
                <div className="border-border text-muted-foreground grid grid-cols-[minmax(160px,1fr)_140px_180px_110px_64px] border-b px-4 py-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
                  <div>Label</div>
                  <div>Token ID</div>
                  <div>Allowed Agents</div>
                  <div>Attribution</div>
                  <div className="text-right">Action</div>
                </div>

                {serviceTokensQuery.isLoading ? (
                  <div className="text-muted-foreground px-4 py-6 text-sm">
                    Loading service tokens…
                  </div>
                ) : null}

                {serviceTokensQuery.data?.tokens.length === 0 ? (
                  <div className="text-muted-foreground px-4 py-8 text-sm">
                    No service tokens yet.
                  </div>
                ) : null}

                {serviceTokensQuery.data?.tokens.map((token) => (
                  <OrganizationServiceTokenRow
                    key={token.id}
                    onRevoke={() => {
                      revokeServiceMutation.mutate(token.id);
                    }}
                    pending={revokeServiceMutation.isPending}
                    token={token}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="border-border bg-card overflow-x-auto rounded-lg border">
            <div className="min-w-[560px]">
              <div className="border-border text-muted-foreground grid grid-cols-[minmax(180px,1fr)_140px_160px_64px] border-b px-4 py-2.5 text-[11px] font-semibold tracking-[0.12em] uppercase">
                <div>Label</div>
                <div>Token ID</div>
                <div>Last Used</div>
                <div className="text-right">Action</div>
              </div>

              {tokensQuery.isLoading ? (
                <div className="text-muted-foreground px-4 py-6 text-sm">Loading tokens…</div>
              ) : null}

              {tokensQuery.data?.tokens.length === 0 ? (
                <div className="text-muted-foreground px-4 py-8 text-sm">No tokens yet.</div>
              ) : null}

              {tokensQuery.data?.tokens.map((token) => (
                <AccessTokenRow
                  key={token.id}
                  onRevoke={() => {
                    revokeMutation.mutate(token.id);
                  }}
                  pending={revokeMutation.isPending}
                  token={token}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
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
