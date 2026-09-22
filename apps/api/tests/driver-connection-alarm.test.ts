import { expect, test } from "bun:test";

test("DriverConnection forwards alarms and propagates finalization failures", async () => {
  // Isolate Cloudflare/delegate mocks from the rest of the API suite.
  const probe = Bun.spawn([process.execPath, "helpers/driver-connection-alarm-probe.ts"], {
    cwd: import.meta.dir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([probe.exited, new Response(probe.stderr).text()]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
