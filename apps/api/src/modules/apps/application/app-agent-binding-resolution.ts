import type { AppDeploymentAgentBinding } from "./app-deployment-detector";

/**
 * Resolve `.mosoo.toml [[agents]]` bindings against an App's agents at deploy
 * time, failing fast if any binding cannot be satisfied (PM decision #3,
 * docs/prd/app-deployment.md "Agent Binding Wedge"): a deploy ships nothing
 * unless every bound agent exists and is published.
 *
 * Pure on purpose — the caller supplies the App's agents (name + published
 * flag, derived from status + liveDeploymentVersionId) so this is unit-testable
 * without the database.
 */

export type AppAgentBindingResolutionErrorCode =
  | "deployment_agent_not_found"
  | "deployment_agent_not_published";

export class AppAgentBindingResolutionError extends Error {
  readonly code: AppAgentBindingResolutionErrorCode;

  constructor(code: AppAgentBindingResolutionErrorCode, message: string) {
    super(message);
    this.name = "AppAgentBindingResolutionError";
    this.code = code;
  }
}

export interface ResolvableAppAgent {
  id: string;
  name: string;
  published: boolean;
}

export interface ResolvedAppAgentBinding {
  agentId: string;
  envVar: string;
  expose: "public_thread";
  name: string;
}

export function resolveAppAgentBindings(
  bindings: readonly AppDeploymentAgentBinding[],
  agents: readonly ResolvableAppAgent[],
): ResolvedAppAgentBinding[] {
  const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));

  return bindings.map((binding) => {
    const agent = agentsByName.get(binding.name);

    if (agent === undefined) {
      throw new AppAgentBindingResolutionError(
        "deployment_agent_not_found",
        `Bound agent "${binding.name}" was not found in this App.`,
      );
    }

    if (!agent.published) {
      throw new AppAgentBindingResolutionError(
        "deployment_agent_not_published",
        `Bound agent "${binding.name}" is not published. Publish it, then re-run deploy.`,
      );
    }

    return {
      agentId: agent.id,
      envVar: binding.env,
      expose: binding.expose,
      name: binding.name,
    };
  });
}
