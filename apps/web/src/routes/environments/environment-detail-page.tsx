import { Permission, can } from "@mosoo/contracts/permission";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, ShieldCheck, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import {
  deleteEnvironment,
  setOrganizationDefaultEnvironment,
  shareEnvironmentWithOrganization,
  shareEnvironmentWithUser,
  unshareEnvironmentTarget,
  updateEnvironment,
} from "@/domains/environment/api/environment-client";
import { EnvironmentForm } from "@/domains/environment/components/environment-form";
import {
  createEnvironmentDraft,
  toUpdateEnvironmentInput,
} from "@/domains/environment/components/environment-form-model";
import type { EnvironmentDraft } from "@/domains/environment/components/environment-form-model";
import {
  environmentKeys,
  useEnvironmentDetailQuery,
} from "@/domains/environment/query/environment-queries";
import { toAccountId, toEnvironmentId, toOrganizationId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentBadges } from "./environment-badges";
export function EnvironmentDetailPage({ environmentId }: { environmentId: string }) {
  const { activeOrganization, activeOrganizationId } = useAppSession();
  const organizationId = activeOrganizationId;
  const typedEnvironmentId = toEnvironmentId(environmentId);
  const typedOrganizationId = organizationId === null ? null : toOrganizationId(organizationId);
  const environmentQuery = useEnvironmentDetailQuery(environmentId);
  const queryClient = useQueryClient();
  const [shareEmail, setShareEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const environment = environmentQuery.data ?? null;
  const [draftOverride, setDraftOverride] = useState<EnvironmentDraft | null>(null);

  async function invalidateEnvironment() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: environmentKeys.detail(environmentId) }),
      typedOrganizationId !== null
        ? queryClient.invalidateQueries({ queryKey: environmentKeys.list(typedOrganizationId) })
        : Promise.resolve(),
    ]);
  }

  const updateMutation = useMutation({
    mutationFn: updateEnvironment,
    onSuccess: invalidateEnvironment,
  });
  const defaultMutation = useMutation({
    mutationFn: setOrganizationDefaultEnvironment,
    onSuccess: invalidateEnvironment,
  });
  const shareUserMutation = useMutation({
    mutationFn: shareEnvironmentWithUser,
    onSuccess: invalidateEnvironment,
  });
  const shareOrgMutation = useMutation({
    mutationFn: shareEnvironmentWithOrganization,
    onSuccess: invalidateEnvironment,
  });
  const unshareMutation = useMutation({
    mutationFn: unshareEnvironmentTarget,
    onSuccess: invalidateEnvironment,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: invalidateEnvironment,
  });
  const isAdmin = can(activeOrganization?.viewerRole, Permission.ProvidersCompanyManage);
  const initialDraft = useMemo(() => createEnvironmentDraft(environment), [environment]);
  const effectiveDraft = draftOverride ?? initialDraft;

  async function handleSave() {
    if (!environment) {
      return;
    }
    setError(null);
    try {
      const updated = await updateMutation.mutateAsync(
        toUpdateEnvironmentInput(environment.id, effectiveDraft),
      );
      setDraftOverride(createEnvironmentDraft(updated));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to save environment.");
    }
  }

  async function handleShareUser() {
    if (!environment || !shareEmail.trim()) {
      return;
    }
    setError(null);
    try {
      await shareUserMutation.mutateAsync({
        email: shareEmail.trim(),
        environmentId: typedEnvironmentId,
      });
      setShareEmail("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to share environment.");
    }
  }

  async function handleShareOrganization() {
    setError(null);
    try {
      await shareOrgMutation.mutateAsync({ environmentId: typedEnvironmentId });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to share environment.");
    }
  }

  async function handleUnshare(targetId: string, targetKind: "organization" | "user") {
    setError(null);
    try {
      await unshareMutation.mutateAsync({
        environmentId: typedEnvironmentId,
        targetId:
          targetKind === "organization" ? toOrganizationId(targetId) : toAccountId(targetId),
        targetKind,
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to unshare environment.",
      );
    }
  }

  async function handleSetDefault() {
    if (!isTruthy(organizationId)) {
      return;
    }
    setError(null);
    try {
      await defaultMutation.mutateAsync({
        environmentId: typedEnvironmentId,
        organizationId: toOrganizationId(organizationId),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to set default environment.",
      );
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteMutation.mutateAsync({ environmentId: typedEnvironmentId });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to delete environment.",
      );
    }
  }

  if (environmentQuery.isLoading) {
    return (
      <div className="text-fg-3 flex-1 overflow-y-auto py-12 text-center text-[13px]">
        Loading environment…
      </div>
    );
  }

  if (environmentQuery.error || !environment) {
    return (
      <div className="text-destructive flex-1 overflow-y-auto py-12 text-center text-[13px]">
        {environmentQuery.error instanceof Error
          ? environmentQuery.error.message
          : "Environment not found."}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
        <div className="border-border flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link className="text-fg-3 hover:text-fg-1 text-[12px] font-medium" to="/environment">
              Environments
            </Link>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-fg-1 text-2xl font-semibold">{environment.name}</h1>
              <EnvironmentBadges environment={environment} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && !environment.isDefault ? (
              <Button className="gap-2" onClick={() => void handleSetDefault()} variant="outline">
                <Star className="size-4" />
                Set default
              </Button>
            ) : null}
            {environment.canDelete ? (
              <Button onClick={() => void handleDelete()} variant="outline">
                Delete
              </Button>
            ) : null}
          </div>
        </div>

        {isTruthy(error) ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-[13px]">
            {error}
          </div>
        ) : null}

        <section className="border-border rounded-md border bg-white p-4">
          <EnvironmentForm
            disabled={!environment.canEdit || updateMutation.isPending}
            draft={effectiveDraft}
            onChange={setDraftOverride}
            onSubmit={() => void handleSave()}
            submitLabel={updateMutation.isPending ? "Saving…" : "Save changes"}
          />
          {!environment.canEdit ? (
            <div className="bg-secondary text-fg-3 mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-[12px]">
              <Lock className="size-3.5" />
              Shared environments are read-only. Fork it from the list to customize.
            </div>
          ) : null}
        </section>

        {environment.canEdit ? (
          <section className="border-border rounded-md border bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="text-accent-press size-4" />
              <h2 className="text-fg-1 text-[14px] font-semibold">Share</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label>Member email</Label>
                <Input
                  onChange={(event) => {
                    setShareEmail(event.target.value);
                  }}
                  placeholder="teammate@mosoo.ai"
                  value={shareEmail}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button
                  disabled={!shareEmail.trim() || shareUserMutation.isPending}
                  onClick={() => void handleShareUser()}
                  variant="outline"
                >
                  Share member
                </Button>
                <Button
                  disabled={shareOrgMutation.isPending}
                  onClick={() => void handleShareOrganization()}
                  variant="outline"
                >
                  Share organization
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {environment.shareTargets.length === 0 ? (
                <div className="border-border text-fg-3 rounded-md border border-dashed p-3 text-[12px]">
                  No share targets.
                </div>
              ) : (
                environment.shareTargets.map((target) => (
                  <div
                    className="border-border flex items-center justify-between rounded-md border px-3 py-2"
                    key={`${target.kind}:${target.id}`}
                  >
                    <div>
                      <div className="text-fg-1 text-[13px] font-medium">
                        {target.kind === "organization"
                          ? "Everyone in organization"
                          : (target.name ?? target.email)}
                      </div>
                      <div className="text-fg-3 text-[12px]">{target.email ?? target.kind}</div>
                    </div>
                    <Button
                      className="h-8"
                      onClick={() => void handleUnshare(target.id, target.kind)}
                      size="sm"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
