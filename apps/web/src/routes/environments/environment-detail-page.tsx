import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import {
  deleteEnvironment,
  setAppDefaultEnvironment,
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
import { toEnvironmentId, toAppId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentBadges } from "./environment-badges";

type EnvironmentDetail = NonNullable<ReturnType<typeof useEnvironmentDetailQuery>["data"]>;

function EnvironmentDetailHeader({
  environment,
  isAdmin,
  onDelete,
  onSetDefault,
}: {
  environment: EnvironmentDetail;
  isAdmin: boolean;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
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
          <Button className="gap-2" onClick={onSetDefault} variant="outline">
            <Star className="size-4" />
            Set default
          </Button>
        ) : null}
        {environment.canDelete ? (
          <Button onClick={onDelete} variant="outline">
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EnvironmentDetailPage({ environmentId }: { environmentId: string }) {
  const { activeAppId } = useAppSession();
  const appId = activeAppId;
  const typedEnvironmentId = toEnvironmentId(environmentId);
  const environmentQuery = useEnvironmentDetailQuery(appId, environmentId);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const environment = environmentQuery.data ?? null;
  const [draftOverride, setDraftOverride] = useState<EnvironmentDraft | null>(null);

  const updateMutation = useMutation({
    mutationFn: updateEnvironment,
    onSuccess: async () => {
      await Promise.all([
        appId !== null
          ? queryClient.invalidateQueries({
              queryKey: environmentKeys.detail(appId, environmentId),
            })
          : Promise.resolve(),
        appId !== null
          ? queryClient.invalidateQueries({ queryKey: environmentKeys.list(appId) })
          : Promise.resolve(),
      ]);
    },
  });
  const defaultMutation = useMutation({
    mutationFn: setAppDefaultEnvironment,
    onSuccess: async () => {
      await Promise.all([
        appId !== null
          ? queryClient.invalidateQueries({
              queryKey: environmentKeys.detail(appId, environmentId),
            })
          : Promise.resolve(),
        appId !== null
          ? queryClient.invalidateQueries({ queryKey: environmentKeys.list(appId) })
          : Promise.resolve(),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: async () => {
      await Promise.all([
        appId !== null
          ? queryClient.invalidateQueries({
              queryKey: environmentKeys.detail(appId, environmentId),
            })
          : Promise.resolve(),
        appId !== null
          ? queryClient.invalidateQueries({ queryKey: environmentKeys.list(appId) })
          : Promise.resolve(),
      ]);
    },
  });
  const initialDraft = useMemo(() => createEnvironmentDraft(environment), [environment]);
  const effectiveDraft = draftOverride ?? initialDraft;

  async function handleSave() {
    if (!environment) {
      return;
    }
    setError(null);
    try {
      const updated = await updateMutation.mutateAsync(
        toUpdateEnvironmentInput(environment.appId, environment.id, effectiveDraft),
      );
      setDraftOverride(createEnvironmentDraft(updated));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to save environment.");
    }
  }

  async function handleSetDefault() {
    if (!environment || !isTruthy(appId)) {
      return;
    }
    setError(null);
    try {
      await defaultMutation.mutateAsync({
        environmentId: typedEnvironmentId,
        appId: toAppId(appId),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Failed to set default environment.",
      );
    }
  }

  async function handleDelete() {
    if (!environment) {
      return;
    }
    setError(null);
    try {
      await deleteMutation.mutateAsync({
        environmentId: typedEnvironmentId,
        appId: environment.appId,
      });
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
        <EnvironmentDetailHeader
          environment={environment}
          isAdmin={environment.canEdit}
          onDelete={() => {
            void handleDelete();
          }}
          onSetDefault={() => {
            void handleSetDefault();
          }}
        />

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
      </div>
    </div>
  );
}
