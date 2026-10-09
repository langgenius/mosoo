import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import type { DriverProfileConfig } from "../../domain/driver-snapshot";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";
import {
  ensureProvisioningDirectories,
  ensureRuntimeMemoryMounts,
  runSetupScript,
} from "./runtime-driver-files.service";
import {
  exposeEnvironmentNodeModules,
  restoreEnvironmentArtifact,
} from "./runtime-environment-artifact";

export async function installRuntimeEnvironment(
  env: ApiBindings,
  input: {
    readonly cloudflareSession: ExecutionSessionHandle;
    readonly profile: DriverProfileConfig;
    readonly sandbox: SandboxHandle;
    readonly timing: RuntimeTimingRecorder;
  },
): Promise<void> {
  await input.timing.measure("materializeDriverFiles", () =>
    Promise.all([
      ensureProvisioningDirectories(input.cloudflareSession, input.profile),
      ensureRuntimeMemoryMounts(input.cloudflareSession, input.profile),
    ]).then(() => undefined),
  );
  const artifact = input.profile.environmentArtifact;
  if (artifact) {
    await input.timing.measure("environmentArtifactRestore", async () => {
      await restoreEnvironmentArtifact(env, input.sandbox, artifact);
      await exposeEnvironmentNodeModules(input.cloudflareSession, {
        nodePaths: artifact.paths.node,
        organizationPath: input.profile.session.sessionOrganizationPath,
      });
    });
  }

  await input.timing.measure("runSetupScript", () =>
    runSetupScript(input.cloudflareSession, input.profile),
  );
}
