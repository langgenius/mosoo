import { GitBranch, Rocket } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";
import { CommandBlock } from "@/shared/ui/command-block";
import { Input } from "@/shared/ui/input";

// Owner/repo charsets mirror the server-side parseGitHubRepoUrl validation
// (apps/api app-deployment.service.ts): owners have no underscore on GitHub.
const GITHUB_REPO_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+\/?$/;

const REPO_SHAPE_ERROR = "Enter a public GitHub repo URL like https://github.com/owner/repo.";

export function deployAppCommand(appId: string): string {
  return `mosoo console apps deploy-app --input-app-id ${appId} --input-repo-url <your-repo>`;
}

/**
 * Repo URL input + Deploy button. Validates the https://github.com/owner/repo
 * shape client-side and surfaces the server error from `deployApp` inline.
 */
export function RepoDeployForm({
  deploying,
  serverError,
  onDeploy,
}: {
  deploying: boolean;
  /** `deployApp` mutation error, shown inline under the input. */
  serverError: string | null;
  onDeploy: (repoUrl: string) => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const [shapeError, setShapeError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = repoUrl.trim();

    if (!GITHUB_REPO_URL_PATTERN.test(trimmed)) {
      setShapeError(REPO_SHAPE_ERROR);
      return;
    }

    setShapeError(null);
    onDeploy(trimmed);
  }

  const error = shapeError ?? serverError;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Public GitHub repo URL"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(event) => {
            setRepoUrl(event.currentTarget.value);
            setShapeError(null);
          }}
          disabled={deploying}
          className="font-mono text-[13px]"
        />
        <Button type="submit" disabled={deploying} className="shrink-0">
          <Rocket className="size-4" />
          {deploying ? "Deploying…" : "Deploy"}
        </Button>
      </div>
      {error === null ? null : <p className="text-destructive text-[12.5px]">{error}</p>}
      <p className="text-fg-3 text-[12.5px]">
        Auto-detects static, worker or agent-only · .mosoo.toml optional override
      </p>
    </form>
  );
}

/**
 * Pre-deploy card on the Overview: connect a public GitHub repo and deploy,
 * with the real CLI command as the terminal alternative.
 */
export function DeployRepoCard({
  appId,
  deploying,
  serverError,
  onDeploy,
}: {
  appId: string;
  deploying: boolean;
  serverError: string | null;
  onDeploy: (repoUrl: string) => void;
}) {
  return (
    <section className="border-border bg-background rounded-xl border px-6 py-6">
      <div className="flex items-center gap-2">
        <GitBranch className="text-fg-2 size-4" />
        <h2 className="text-fg-1 text-sm font-semibold">Deploy from a public GitHub repo</h2>
      </div>
      <p className="text-fg-3 mt-1.5 text-[13.5px] leading-relaxed">
        Mosoo pulls your default branch HEAD, builds it, and binds your agents.
      </p>
      <div className="mt-4">
        <RepoDeployForm deploying={deploying} serverError={serverError} onDeploy={onDeploy} />
      </div>
      <div className="mt-4">
        <div className="text-fg-3 mb-2 text-[13px]">Or deploy from your terminal:</div>
        <CommandBlock command={deployAppCommand(appId)} />
      </div>
    </section>
  );
}
