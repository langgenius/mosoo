import type { AppDeploymentSecret } from "@mosoo/contracts/app";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Terminal, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import {
  deleteAppDeploymentSecret,
  listAppDeploymentSecrets,
  setAppDeploymentSecret,
} from "@/domains/app/api/app-deployment-client";
import { toAppId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { CommandBlock } from "@/shared/ui/command-block";
import { Input } from "@/shared/ui/input";

import {
  APP_DEPLOYMENT_SECRET_EXAMPLE_NAME,
  deleteAppDeploymentSecretCommand,
  listAppDeploymentSecretsCommand,
  setAppDeploymentSecretCommand,
} from "./deployment-secret-commands";

function secretQueryKey(appId: string) {
  return ["app-deployment-secrets", appId] as const;
}

function SecretList({
  secrets,
  onDelete,
  deleting,
}: {
  deleting: string | null;
  onDelete: (name: string) => void;
  secrets: readonly AppDeploymentSecret[];
}) {
  if (secrets.length === 0) {
    return <p className="text-fg-3 text-[13px]">No App secrets configured.</p>;
  }

  return (
    <ul className="divide-border rounded-md border">
      {secrets.map((secret) => (
        <li key={secret.name} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <code className="text-fg-1 truncate text-[12.5px] font-semibold">{secret.name}</code>
            <p className="text-fg-3 mt-0.5 text-[11.5px]">
              Last updated {new Date(secret.updatedAt).toLocaleString()}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${secret.name} from future deployments`}
            disabled={deleting !== null}
            onClick={() => onDelete(secret.name)}
          >
            {deleting === secret.name ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A write-only owner surface for the secrets a repository declares in
 * `[secrets].required`. Values are never returned after this form submits.
 */
export function DeploymentSecrets({ appId }: { appId: string }) {
  const typedAppId = toAppId(appId);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const secretsQuery = useQuery({
    queryFn: () => listAppDeploymentSecrets(typedAppId),
    queryKey: secretQueryKey(appId),
  });
  const setSecretMutation = useMutation({
    mutationFn: setAppDeploymentSecret,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: secretQueryKey(appId) });
    },
  });
  const deleteSecretMutation = useMutation({
    mutationFn: deleteAppDeploymentSecret,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: secretQueryKey(appId) });
    },
  });
  const exampleSecretName = secretsQuery.data?.[0]?.name ?? APP_DEPLOYMENT_SECRET_EXAMPLE_NAME;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    try {
      await setSecretMutation.mutateAsync({ appId: typedAppId, name, value });
      setName("");
      setValue("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save App secret.");
    }
  }

  async function removeForFutureDeployments(nameToDelete: string) {
    setFormError(null);

    try {
      await deleteSecretMutation.mutateAsync({ appId: typedAppId, name: nameToDelete });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Could not remove App secret from future deployments.",
      );
    }
  }

  return (
    <section
      aria-labelledby="deployment-secrets-heading"
      className="border-border mt-10 border-t pt-7"
    >
      <div className="flex items-start gap-3">
        <span className="bg-muted text-fg-2 mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md">
          <KeyRound className="size-4" />
        </span>
        <div>
          <h2 id="deployment-secrets-heading" className="text-fg-1 text-base font-semibold">
            App secrets
          </h2>
          <p className="text-fg-3 mt-1 max-w-2xl text-[13px] leading-5">
            Values are write-only and are sent only as Cloudflare Worker secret bindings during
            deployment. Declare names, never values, in <code>[secrets].required</code> in
            <code> .mosoo.toml</code>; save or rotate a value here, then redeploy.
          </p>
          <p className="text-fg-3 mt-2 max-w-2xl text-[13px] leading-5">
            Removing a value stops future deployments from submitting it. It does not remove the
            binding from an already deployed Worker; a later successful deployment replaces that
            Worker binding set.
          </p>
        </div>
      </div>

      <div className="mt-5 grid max-w-2xl gap-4">
        {secretsQuery.isLoading ? (
          <p className="text-fg-3 flex items-center gap-2 text-[13px]">
            <Loader2 className="size-3.5 animate-spin" /> Loading secrets…
          </p>
        ) : secretsQuery.isError ? (
          <p className="text-destructive text-[13px]">Could not load App secrets.</p>
        ) : (
          <SecretList
            secrets={secretsQuery.data ?? []}
            deleting={
              deleteSecretMutation.isPending ? (deleteSecretMutation.variables?.name ?? null) : null
            }
            onDelete={(nameToDelete) => void removeForFutureDeployments(nameToDelete)}
          />
        )}

        <form
          onSubmit={(event) => void submit(event)}
          className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]"
        >
          <Input
            aria-label="App secret name"
            autoComplete="off"
            disabled={setSecretMutation.isPending}
            onChange={(event) => setName(event.target.value)}
            placeholder="MOSOO_API_TOKEN"
            value={name}
          />
          <Input
            aria-label="App secret value"
            autoComplete="new-password"
            disabled={setSecretMutation.isPending}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Secret value"
            type="password"
            value={value}
          />
          <Button
            type="submit"
            disabled={setSecretMutation.isPending || name === "" || value === ""}
          >
            {setSecretMutation.isPending ? "Saving…" : "Save secret"}
          </Button>
        </form>
        {formError === null ? null : <p className="text-destructive text-[13px]">{formError}</p>}
        <div className="border-brand/25 bg-brand-light rounded-lg border px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Terminal className="text-brand size-4 shrink-0" />
            <h3 className="text-fg-1 text-[13px] font-semibold">
              Manage App secrets from your terminal
            </h3>
          </div>
          <p className="text-fg-2 mt-1.5 text-[12.5px] leading-relaxed">
            The generated <code>mosoo console</code> commands use the same App-scoped secret API.
            Values stay write-only; use a JSON body file so they stay out of shell history.
          </p>
          <div className="mt-2.5 grid gap-2">
            <CommandBlock
              className="bg-white"
              command={listAppDeploymentSecretsCommand(appId)}
              copyLabel="Copy list secrets command"
            />
            <CommandBlock
              className="bg-white"
              command={setAppDeploymentSecretCommand(appId, exampleSecretName)}
              copyLabel="Copy set secret command"
              multiline
            />
            <CommandBlock
              className="bg-white"
              command={deleteAppDeploymentSecretCommand(appId, exampleSecretName)}
              copyLabel="Copy delete secret command"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
