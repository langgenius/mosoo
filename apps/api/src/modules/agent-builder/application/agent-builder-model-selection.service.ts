import type { AgentBuilderPlannerContext } from "@mosoo/contracts/agent-builder";
import type { AccountId } from "@mosoo/id";

import { getSystemAgentModel } from "../../users/application/viewer-context.service";

export interface AgentBuilderSystemAgentModelSelection {
  model: string;
  provider: string;
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAgentBuilderRequestDigest(
  context: AgentBuilderPlannerContext,
): Promise<string> {
  return sha256Hex(JSON.stringify(context));
}

export async function resolveAgentBuilderSystemAgentModelSelection(
  database: D1Database,
  actorAccountId: AccountId,
): Promise<AgentBuilderSystemAgentModelSelection | null> {
  const systemAgentModel = await getSystemAgentModel(database, actorAccountId);

  if (!systemAgentModel) {
    return null;
  }

  const model = systemAgentModel.modelId.trim();
  const provider = systemAgentModel.vendor.trim();

  return model.length === 0 || provider.length === 0 ? null : { model, provider };
}
