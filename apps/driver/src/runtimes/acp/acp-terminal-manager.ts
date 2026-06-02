import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import type { DriverEventInput } from "@mosoo/driver-protocol";

import type { AgentDriverContext } from "../agent-driver-backend";
import { isRecord, readArray, readNonEmptyString, readNumber, readString } from "./acp-types";
import type { JsonObject } from "./acp-types";

interface AcpTerminalState {
  readonly command: string;
  readonly cwd: string | null;
  readonly exited: Promise<AcpTerminalExitStatus>;
  readonly id: string;
  output: string;
  readonly outputByteLimit: number | null;
  readonly process: ChildProcessWithoutNullStreams;
  truncated: boolean;
}

interface AcpTerminalExitStatus {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

interface AcpTerminalManagerOptions {
  readonly allowedRoots: readonly string[];
  readonly cwd: string;
  push(context: AgentDriverContext, reason: string, events: DriverEventInput[]): Promise<void>;
}

const DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT = 1024 * 1024;

export class AcpTerminalManager {
  readonly #allowedRoots: readonly string[];
  readonly #cwd: string;
  readonly #options: AcpTerminalManagerOptions;
  readonly #terminals = new Map<string, AcpTerminalState>();

  constructor(options: AcpTerminalManagerOptions) {
    this.#allowedRoots = [options.cwd, ...options.allowedRoots].map((root) =>
      resolve(options.cwd, root),
    );
    this.#cwd = resolve(options.cwd);
    this.#options = options;
  }

  async create(context: AgentDriverContext, params: unknown): Promise<{ terminalId: string }> {
    const record = isRecord(params) ? params : {};
    const command = readNonEmptyString(record, "command");

    if (command === null) {
      throw new Error("ACP terminal/create requires a command.");
    }

    const args = readArray(record, "args").filter(
      (entry): entry is string => typeof entry === "string",
    );
    const cwd = this.#resolveAllowedCwd(readNonEmptyString(record, "cwd") ?? this.#cwd);
    const requestedOutputByteLimit = readNumber(record, "outputByteLimit");
    const outputByteLimit = normalizeOutputByteLimit(requestedOutputByteLimit);
    const env = this.#readTerminalEnv(record);
    const terminalId = randomUUID();
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exited = new Promise<AcpTerminalExitStatus>((resolveExit) => {
      child.once("exit", (exitCode, signal) => {
        const status = { exitCode, signal };
        resolveExit(status);
        void this.#options.push(context, "driver.acp.terminal.exited", [
          {
            kind: "terminal.exited",
            payload: {
              exitCode,
              signal,
              terminalId,
            },
          },
        ]);
      });
    });
    const terminal: AcpTerminalState = {
      command,
      cwd,
      exited,
      id: terminalId,
      output: "",
      outputByteLimit,
      process: child,
      truncated: false,
    };

    this.#terminals.set(terminalId, terminal);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      void this.#appendOutput(context, terminal, "stdout", chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      void this.#appendOutput(context, terminal, "stderr", chunk);
    });
    child.on("error", (error) => {
      void this.#options.push(context, "driver.acp.terminal.failed", [
        {
          kind: "diagnostic.reported",
          payload: {
            message: error.message,
            phase: "terminal",
            severity: "error",
            terminalId,
          },
          visibility: "owner_debug",
        },
      ]);
    });

    await this.#options.push(context, "driver.acp.terminal.created", [
      {
        kind: "terminal.created",
        payload: {
          command,
          cwd,
          outputByteLimit,
          terminalId,
        },
      },
    ]);

    return { terminalId };
  }

  async kill(context: AgentDriverContext, params: unknown): Promise<Record<string, never>> {
    const terminal = this.#requireTerminal(params);

    terminal.process.kill("SIGTERM");
    await this.#options.push(context, "driver.acp.terminal.killed", [
      {
        kind: "terminal.killed",
        payload: {
          terminalId: terminal.id,
        },
      },
    ]);

    return {};
  }

  output(params: unknown): {
    exitStatus: AcpTerminalExitStatus | null;
    output: string;
    truncated: boolean;
  } {
    const terminal = this.#requireTerminal(params);
    const status = this.#readExitStatus(terminal);

    return {
      exitStatus: status,
      output: terminal.output,
      truncated: terminal.truncated,
    };
  }

  async release(context: AgentDriverContext, params: unknown): Promise<Record<string, never>> {
    const terminal = this.#requireTerminal(params);

    if (terminal.process.exitCode === null && terminal.process.signalCode === null) {
      terminal.process.kill("SIGTERM");
    }

    this.#terminals.delete(terminal.id);
    await this.#options.push(context, "driver.acp.terminal.released", [
      {
        kind: "terminal.released",
        payload: {
          terminalId: terminal.id,
        },
      },
    ]);

    return {};
  }

  async waitForExit(params: unknown): Promise<AcpTerminalExitStatus> {
    const terminal = this.#requireTerminal(params);
    const currentStatus = this.#readExitStatus(terminal);

    if (currentStatus !== null) {
      return currentStatus;
    }

    return terminal.exited;
  }

  async stopAll(context: AgentDriverContext): Promise<void> {
    const terminals = [...this.#terminals.values()];

    for (const terminal of terminals) {
      await this.release(context, { terminalId: terminal.id });
    }
  }

  async #appendOutput(
    context: AgentDriverContext,
    terminal: AcpTerminalState,
    stream: "stderr" | "stdout",
    chunk: string,
  ): Promise<void> {
    terminal.output = `${terminal.output}${chunk}`;
    const byteLimit = terminal.outputByteLimit;

    if (byteLimit !== null && Buffer.byteLength(terminal.output, "utf8") > byteLimit) {
      terminal.truncated = true;
      terminal.output = truncateOutputToByteLimit(terminal.output, byteLimit);
    }

    await this.#options.push(context, "driver.acp.terminal.output", [
      {
        delivery: "best_effort",
        kind: "terminal.output.delta",
        payload: {
          data: chunk,
          stream,
          terminalId: terminal.id,
          truncated: terminal.truncated,
        },
      },
    ]);
  }

  #readExitStatus(terminal: AcpTerminalState): AcpTerminalExitStatus | null {
    if (terminal.process.exitCode === null && terminal.process.signalCode === null) {
      return null;
    }

    return {
      exitCode: terminal.process.exitCode,
      signal: terminal.process.signalCode,
    };
  }

  #readTerminalEnv(record: JsonObject): Record<string, string> {
    const env: Record<string, string> = {};

    for (const entry of readArray(record, "env")) {
      if (!isRecord(entry)) {
        continue;
      }

      const name = readNonEmptyString(entry, "name");
      const value = readString(entry, "value");

      if (name !== null && value !== null) {
        env[name] = value;
      }
    }

    return env;
  }

  #resolveAllowedCwd(cwd: string): string {
    if (!isAbsolute(cwd)) {
      throw new Error(`ACP terminal cwd must be absolute: ${cwd}.`);
    }

    const resolvedPath = resolve(this.#cwd, cwd);

    if (
      this.#allowedRoots.some(
        (root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`),
      )
    ) {
      return resolvedPath;
    }

    throw new Error(`ACP terminal cwd is outside the allowed roots: ${cwd}.`);
  }

  #requireTerminal(params: unknown): AcpTerminalState {
    const terminalId = readNonEmptyString(isRecord(params) ? params : null, "terminalId");

    if (terminalId === null) {
      throw new Error("ACP terminal method requires a terminalId.");
    }

    const terminal = this.#terminals.get(terminalId);

    if (!terminal) {
      throw new Error(`ACP terminal does not exist: ${terminalId}.`);
    }

    return terminal;
  }
}

function normalizeOutputByteLimit(value: number | null): number {
  if (value === null) {
    return DEFAULT_TERMINAL_OUTPUT_BYTE_LIMIT;
  }

  if (value < 0) {
    throw new Error("ACP terminal outputByteLimit must be zero or greater.");
  }

  return Math.floor(value);
}

function truncateOutputToByteLimit(output: string, byteLimit: number): string {
  if (byteLimit === 0) {
    return "";
  }

  let totalBytes = 0;
  const retained: string[] = [];

  for (const character of Array.from(output).toReversed()) {
    const size = Buffer.byteLength(character, "utf8");

    if (totalBytes + size > byteLimit) {
      break;
    }

    retained.push(character);
    totalBytes += size;
  }

  return retained.toReversed().join("");
}
