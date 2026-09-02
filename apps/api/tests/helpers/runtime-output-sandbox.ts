import type { SandboxHandle } from "../../src/modules/runtime/infrastructure/sandbox-handles";

const encoder = new TextEncoder();

export interface RuntimeOutputSandboxOptions {
  readonly files?: ReadonlyMap<string, string | Uint8Array>;
  readonly fileSizes?: ReadonlyMap<string, number>;
  readonly listError?: Error;
  readonly onExec?: (command: string) => void;
  readonly onRead?: (path: string) => void;
  readonly readError?: Error;
  readonly root?: string;
}

export function createRuntimeOutputSandbox(
  options: RuntimeOutputSandboxOptions = {},
): SandboxHandle {
  const root = (options.root ?? "/workspace/outputs").replace(/\/+$/, "");
  const entries = () =>
    [...(options.files ?? [])]
      .map(([path, content]) => {
        const absolutePath = path.startsWith("/") ? path : `${root}/${path}`;
        return {
          absolutePath,
          bytes: typeof content === "string" ? encoder.encode(content) : content,
          path,
          relativePath: absolutePath.slice(root.length + 1),
        };
      })
      .filter(({ absolutePath }) => absolutePath.startsWith(`${root}/`));
  const sizeOf = (entry: ReturnType<typeof entries>[number]) =>
    options.fileSizes?.get(entry.path) ??
    options.fileSizes?.get(entry.absolutePath) ??
    entry.bytes.byteLength;
  const findCommandEntry = (command: string) =>
    entries().find(({ absolutePath }) => command.includes(absolutePath));
  const failed = (stderr: string, exitCode = 1) => ({
    exitCode,
    stderr,
    stdout: "",
    success: false,
  });
  const succeeded = (stdout = "") => ({ exitCode: 0, stderr: "", stdout, success: true });
  const unavailable = (): Promise<never> =>
    Promise.reject(new Error("Unexpected sandbox test method call."));
  const exec: SandboxHandle["exec"] = async (command) => {
    options.onExec?.(command);
    if (command.includes("find . -type f")) {
      if (options.listError !== undefined) {
        return failed(options.listError.message);
      }
      return succeeded(
        entries()
          .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))
          .map((entry) => `./${entry.relativePath}\0${sizeOf(entry)}\0`)
          .join(""),
      );
    }
    if (command.includes("stat --printf=")) {
      const entry = findCommandEntry(command);
      return entry === undefined
        ? failed("missing test file", 44)
        : succeeded(String(sizeOf(entry)));
    }
    if (command.includes("head -c")) {
      const entry = findCommandEntry(command);
      if (entry === undefined) {
        return failed("missing test file");
      }
      options.onRead?.(entry.absolutePath);
      if (options.readError !== undefined) {
        return failed(options.readError.message);
      }
      return succeeded(
        entry.bytes.subarray(0, Number(command.match(/head -c (\d+)/)?.[1])).toBase64(),
      );
    }
    return succeeded();
  };
  const session = {
    exec,
    mkdir: unavailable,
    readFile: unavailable,
    startProcess: unavailable,
    watch: unavailable,
    writeFile: unavailable,
  };

  return {
    ...session,
    configureNetworkConstraints: unavailable,
    createBackup: unavailable,
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: unavailable,
    getSession: async () => session,
    mountBucket: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: unavailable,
    terminal: unavailable,
    unmountBucket: unavailable,
    wsConnect: unavailable,
  };
}
