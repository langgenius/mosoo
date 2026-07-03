interface ImportMetaEnv {
  readonly VITE_APP_DEPLOYMENT_LOCAL_PREVIEW_URL?: string;
  readonly VITE_CHANNEL_WEBHOOK_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
