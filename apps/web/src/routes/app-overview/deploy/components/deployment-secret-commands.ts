export const APP_DEPLOYMENT_SECRET_EXAMPLE_NAME = "MOSOO_API_TOKEN";

export function listAppDeploymentSecretsCommand(appId: string): string {
  return `mosoo console apps app-deployment-secret-list --app-id ${appId}`;
}

export function setAppDeploymentSecretCommand(
  appId: string,
  name = APP_DEPLOYMENT_SECRET_EXAMPLE_NAME,
): string {
  return [
    "(",
    'secret_file="$(mktemp)"',
    "trap 'rm -f \"$secret_file\"' EXIT",
    "cat > \"$secret_file\" <<'JSON'",
    "{",
    '  "input": {',
    `    "appId": "${appId}",`,
    `    "name": "${name}",`,
    '    "value": "<secret-value>"',
    "  }",
    "}",
    "JSON",
    'mosoo console apps set-app-deployment-secret --file "$secret_file" -o json',
    ")",
  ].join("\n");
}

export function deleteAppDeploymentSecretCommand(
  appId: string,
  name = APP_DEPLOYMENT_SECRET_EXAMPLE_NAME,
): string {
  return `mosoo console apps delete-app-deployment-secret --input-app-id ${appId} --input-name ${name}`;
}
