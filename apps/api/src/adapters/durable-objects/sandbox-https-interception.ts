interface SandboxHttpsInterception {
  interceptHttps: boolean;
}

export function disableLocalSandboxHttpsInterception(
  sandbox: SandboxHttpsInterception,
  localBinding: string | undefined,
): void {
  // Local workerd can omit the ephemeral CA while HTTPS interception is active,
  // resetting TLS before the sandbox reaches providers. Production keeps the SDK default.
  if (localBinding === "true") {
    sandbox.interceptHttps = false;
  }
}
