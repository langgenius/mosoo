import { createProcessSupervisor } from "../../docker/process-supervisor";

const markerPath = process.env["MOSOO_SIGNAL_MARKER"];
if (!markerPath) {
  throw new Error("MOSOO_SIGNAL_MARKER is required.");
}

const supervisor = createProcessSupervisor();
const removeSignalHandlers = supervisor.installSignalHandlers();
const migration = supervisor.track(
  Bun.spawn(
    [
      "bun",
      "-e",
      `
        import { writeFileSync } from "node:fs";
        const markerPath = process.env["MOSOO_SIGNAL_MARKER"];
        process.on("SIGTERM", () => {
          writeFileSync(markerPath, "SIGTERM\\n", "utf8");
          process.exit(0);
        });
        process.stdout.write("MIGRATION_READY\\n");
        setInterval(() => {}, 1_000);
      `,
    ],
    {
      env: process.env,
      stderr: "inherit",
      stdout: "pipe",
    },
  ),
);

const reader = migration.stdout.getReader();
const decoder = new TextDecoder();
let output = "";
while (!output.includes("MIGRATION_READY\n")) {
  const chunk = await reader.read();
  if (chunk.done) {
    throw new Error("Migration exited before becoming ready.");
  }
  output += decoder.decode(chunk.value, { stream: true });
}

process.stdout.write("HARNESS_READY\n");
const exitCode = await migration.exited;
supervisor.untrack(migration);
removeSignalHandlers();

if (!supervisor.stopping) {
  throw new Error(`Migration exited unexpectedly with code ${exitCode}.`);
}
if (supervisor.receivedSignal !== "SIGTERM") {
  throw new Error(`Expected external SIGTERM, received ${supervisor.receivedSignal ?? "none"}.`);
}
process.stdout.write("HARNESS_STOPPED\n");
