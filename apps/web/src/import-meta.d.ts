interface ImportMetaEnv {
  readonly VITE_MOSOO_DEPLOYMENT_MODE?: string;
  readonly VITE_MOSOO_ENVIRONMENT?: string;
  readonly VITE_POSTHOG_API_HOST?: string;
  readonly VITE_POSTHOG_PROJECT_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
