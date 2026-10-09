import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useActiveProject } from "@/app/session/session-context";
import {
  deleteEnvironment,
  setProjectDefaultEnvironment,
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
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Lock, Star } from "@/shared/ui/icons";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentBadges } from "./environment-badges";

type EnvironmentDetail = NonNullable<ReturnType<typeof useEnvironmentDetailQuery>["data"]>;

function EnvironmentDetailHeader({
  environment,
  onDelete,
  onSetDefault,
}: {
  environment: EnvironmentDetail;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="border-border flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <Link className="text-fg-3 hover:text-fg-1 text-[12px] font-medium" to="/environment">
          {t("environments.title")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-fg-1 text-2xl font-semibold">{environment.name}</h1>
          <EnvironmentBadges environment={environment} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {environment.canEdit && !environment.isDefault ? (
          <Button className="gap-2" onClick={onSetDefault} variant="outline">
            <Star className="size-4" />
            {t("environments.setDefault")}
          </Button>
        ) : null}
        {environment.canDelete ? (
          <Button onClick={onDelete} variant="outline">
            {t("common.delete")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EnvironmentDetailPage({ environmentId }: { environmentId: string }) {
  const { t } = useTranslation();
  const project = useActiveProject();
  const navigate = useNavigate();
  const environmentQuery = useEnvironmentDetailQuery(project.id, environmentId);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const environment = environmentQuery.data ?? null;
  const [draftOverride, setDraftOverride] = useState<EnvironmentDraft | null>(null);

  async function invalidateEnvironment(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: environmentKeys.detail(project.id, environmentId),
      }),
      queryClient.invalidateQueries({ queryKey: environmentKeys.list(project.id) }),
    ]);
  }

  const updateMutation = useMutation({
    mutationFn: updateEnvironment,
    onSuccess: invalidateEnvironment,
  });
  const defaultMutation = useMutation({
    mutationFn: setProjectDefaultEnvironment,
    onSuccess: invalidateEnvironment,
  });
  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: environmentKeys.list(project.id) });
      void navigate("/environment");
    },
  });
  const initialDraft = useMemo(() => createEnvironmentDraft(environment), [environment]);
  const effectiveDraft = draftOverride ?? initialDraft;

  async function handleSave(target: EnvironmentDetail) {
    setError(null);
    try {
      const updated = await updateMutation.mutateAsync(
        toUpdateEnvironmentInput(target.projectId, target.id, effectiveDraft, t),
      );
      setDraftOverride(createEnvironmentDraft(updated));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t("environments.saveFailed"));
    }
  }

  async function handleSetDefault(target: EnvironmentDetail) {
    setError(null);
    try {
      await defaultMutation.mutateAsync({
        environmentId: target.id,
        projectId: target.projectId,
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : t("environments.setDefaultFailed"),
      );
    }
  }

  async function handleDelete(target: EnvironmentDetail) {
    setError(null);
    try {
      await deleteMutation.mutateAsync({
        environmentId: target.id,
        projectId: target.projectId,
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t("environments.deleteFailed"));
    }
  }

  if (environmentQuery.isLoading) {
    return (
      <div className="text-fg-3 flex-1 overflow-y-auto py-12 text-center text-[13px]">
        {t("environments.loadingDetail")}
      </div>
    );
  }

  if (environmentQuery.error || !environment) {
    return (
      <div className="text-danger flex-1 overflow-y-auto py-12 text-center text-[13px]">
        {environmentQuery.error instanceof Error
          ? environmentQuery.error.message
          : t("environments.notFound")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
        <EnvironmentDetailHeader
          environment={environment}
          onDelete={() => {
            void handleDelete(environment);
          }}
          onSetDefault={() => {
            void handleSetDefault(environment);
          }}
        />

        {isTruthy(error) ? (
          <div className="border-danger/30 bg-danger/10 text-danger rounded-md border px-3 py-2 text-[13px]">
            {error}
          </div>
        ) : null}

        <section className="border-border bg-card rounded-md border p-4">
          <EnvironmentForm
            disabled={!environment.canEdit || updateMutation.isPending}
            draft={effectiveDraft}
            onChange={setDraftOverride}
            onSubmit={() => void handleSave(environment)}
            submitLabel={
              updateMutation.isPending ? t("settings.saving") : t("settings.saveChanges")
            }
          />
          {!environment.canEdit ? (
            <div className="bg-paper-200 text-fg-3 mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-[12px]">
              <Lock className="size-3.5" />
              {t("environments.readOnly")}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
