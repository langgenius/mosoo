interface ImportMetaEnv {
  readonly VITE_POSTHOG_PROJECT_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
