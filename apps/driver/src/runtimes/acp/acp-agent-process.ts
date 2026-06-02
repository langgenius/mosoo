import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";

import type { DriverBootPayload } from "@mosoo/driver-protocol";
import { settlePromiseWithTimeout } from "@mosoo/effects";

import { summarizePath } from "../../infrastructure/logging/driver-debug";
import type { AgentDriverContext } from "../agent-driver-backend";
import { readAcpFallbackArgs, readAcpFallbackCommand } from "./acp-configuration";

export type AcpAgentProcess = ChildProcessByStdio<Writable, Readable, Readable>;

const ACP_AGENT_EXIT_TIMEOUT_MS = 2_000;
const ACP_AGENT_FORCE_KILL_TIMEOUT_MS = 1_000;

export async function startAcpAgentProcess(
  context: AgentDriverContext,
  payload: DriverBootPayload,
  env: Record<string, string>,
): Promise<AcpAgentProcess> {
  const command = readAcpFallbackCommand();
  const args = readAcpFallbackArgs();

  await mkdir(payload.execution.session.context.homePath, { recursive: true });
  await mkdir(env["MOSOO_ACP_HOME"] ?? payload.execution.session.context.homePath, {
    recursive: true,
  });

  context.logger.info("driver.acp.agent.spawning", {
    args,
    command,
  });
  context.logger.debug("driver.acp.agent.spawn.prepared", {
    cwd: summarizePath(payload.execution.session.cwd),
    envVarCount: Object.keys(env).length,
  });

  const agentProcess = spawn(command, args, {
    cwd: payload.execution.session.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  agentProcess.stderr.setEncoding("utf8");
  agentProcess.stderr.on("data", (chunk: string) => {
    const trimmed = chunk.trim();

    if (trimmed.length === 0) {
      return;
    }

    context.logger.warn("driver.acp.agent.stderr", {
      chunk: trimmed,
    });
  });
  agentProcess.on("error", (error) => {
    context.logger.error("driver.acp.agent.spawn.error", error, {
      command,
    });
  });
  agentProcess.on("exit", (code, signal) => {
    context.logger.info("driver.acp.agent.exited", {
      code,
      signal,
    });
  });

  return agentProcess;
}

export async function stopAcpAgentProcess(
  context: AgentDriverContext,
  agentProcess: AcpAgentProcess,
  reason: string,
): Promise<void> {
  if (agentProcess.exitCode !== null || agentProcess.signalCode !== null) {
    return;
  }

  agentProcess.kill("SIGTERM");
  const exited = await waitForChildProcessExit(agentProcess, ACP_AGENT_EXIT_TIMEOUT_MS);

  if (exited) {
    return;
  }

  context.logger.warn("driver.acp.agent.exit.timed_out", {
    reason,
    timeoutMs: ACP_AGENT_EXIT_TIMEOUT_MS,
  });
  agentProcess.kill("SIGKILL");
  await waitForChildProcessExit(agentProcess, ACP_AGENT_FORCE_KILL_TIMEOUT_MS);
}

async function waitForChildProcessExit(
  process: AcpAgentProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return true;
  }

  const exited = new Promise<boolean>((resolve) => {
    process.once("exit", () => resolve(true));
  });
  const result = await settlePromiseWithTimeout(exited, {
    label: "ACP agent process exit",
    timeoutMs,
  });

  if (result.status === "completed") {
    return result.value;
  }

  if (result.status === "timed_out") {
    return false;
  }

  throw result.error;
}
