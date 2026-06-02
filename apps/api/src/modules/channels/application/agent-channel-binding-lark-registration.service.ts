import type { AgentId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ApiError, validationError } from "../../../platform/errors";
import type { ApiErrorCode } from "../../../platform/errors";
import { ensureAgentEditor } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { pollLarkAppRegistration, startLarkAppRegistration } from "../lark/lark-app-registration";
import { ensureProviderBindingAvailable } from "./agent-channel-binding-records";
import type {
  LarkAgentChannelRegistration,
  PollLarkAgentChannelRegistrationInput,
  StartLarkAgentChannelRegistrationInput,
} from "./agent-channel-binding.types";

function mapLarkRegistrationError(error: unknown, code: ApiErrorCode): Error {
  if (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    return new ApiError(502, code, "Lark / Feishu app registration request failed.");
  }

  if (error instanceof Error) {
    return new ApiError(502, code, error.message);
  }

  return new ApiError(502, code, "Lark / Feishu app registration request failed.");
}

async function ensureAgentCanRegisterLarkChannel(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<void> {
  const viewerId = viewer.id;
  const access = await ensureAgentEditor(database, viewerId, agentId);

  if (access.agent.status !== "published") {
    throw validationError(
      "Publish the Agent before connecting Lark / Feishu.",
      "AGENT_NOT_PUBLISHED",
    );
  }

  await ensureProviderBindingAvailable(database, {
    agentId,
    provider: "lark",
  });
}

export async function startLarkAgentChannelRegistration(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: StartLarkAgentChannelRegistrationInput,
): Promise<LarkAgentChannelRegistration> {
  await ensureAgentCanRegisterLarkChannel(bindings.DB, viewer, input.agentId);

  try {
    const registration = await startLarkAppRegistration(input.domain);

    return {
      appId: null,
      appSecret: null,
      deviceCode: registration.deviceCode,
      domain: registration.domain,
      expireIn: registration.expireIn,
      interval: registration.interval,
      lastErrorCode: null,
      openId: null,
      qrUrl: registration.qrUrl,
      status: registration.status,
      userCode: registration.userCode,
    };
  } catch (error) {
    throw mapLarkRegistrationError(error, "LARK_APP_REGISTRATION_START_FAILED");
  }
}

export async function pollLarkAgentChannelRegistration(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: PollLarkAgentChannelRegistrationInput,
): Promise<LarkAgentChannelRegistration> {
  await ensureAgentCanRegisterLarkChannel(bindings.DB, viewer, input.agentId);

  try {
    const registration = await pollLarkAppRegistration({
      deviceCode: input.deviceCode,
      domain: input.domain,
    });

    return {
      appId: registration.appId,
      appSecret: registration.appSecret,
      deviceCode: input.deviceCode.trim(),
      domain: registration.domain,
      expireIn: null,
      interval: null,
      lastErrorCode: registration.lastErrorCode,
      openId: registration.openId,
      qrUrl: null,
      status: registration.status,
      userCode: null,
    };
  } catch (error) {
    throw mapLarkRegistrationError(error, "LARK_APP_REGISTRATION_POLL_FAILED");
  }
}
