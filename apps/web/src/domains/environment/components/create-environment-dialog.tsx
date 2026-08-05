import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createEnvironment } from "@/domains/environment/api/environment-client";
import { EnvironmentCliCallout } from "@/domains/environment/components/environment-cli-callout";
import { environmentKeys } from "@/domains/environment/query/environment-queries";
import { useTranslation } from "@/shared/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { isTruthy } from "../../../shared/lib/truthiness";
import { EnvironmentForm } from "./environment-form";
import { createEnvironmentDraft, toCreateEnvironmentInput } from "./environment-form-model";
export function CreateEnvironmentDialog({
  onCreated,
  onOpenChange,
  open,
  appId,
}: {
  onCreated?: (environment: EnvironmentSummary) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  appId: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createEnvironmentDraft());
  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: createEnvironment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: environmentKeys.list(appId),
      });
    },
  });

  async function handleCreate() {
    setError(null);

    try {
      const created = await createMutation.mutateAsync(toCreateEnvironmentInput(appId, draft, t));
      setDraft(createEnvironmentDraft());
      onCreated?.(created);
      onOpenChange(false);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : t("environments.createFailed"),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !createMutation.isPending) {
          setDraft(createEnvironmentDraft());
          setError(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("environments.create")}</DialogTitle>
          <DialogDescription>{t("environments.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <EnvironmentCliCallout />

        {isTruthy(error) ? (
          <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-[13px]">
            {error}
          </div>
        ) : null}

        <EnvironmentForm
          disabled={createMutation.isPending}
          draft={draft}
          onCancel={() => {
            onOpenChange(false);
          }}
          onChange={setDraft}
          onSubmit={() => void handleCreate()}
          submitLabel={
            createMutation.isPending ? t("environments.creating") : t("environments.create")
          }
        />
      </DialogContent>
    </Dialog>
  );
}
