import type { UserConfig } from "vite-plus";

import { createSharedLintConfig, sharedFmtConfig } from "./config/vite-plus.shared.ts";

const generatedGraphqlIgnorePatterns = [
  "apps/api/src/adapters/graphql/schema.generated.graphql",
  "apps/web/src/gql/**",
] as const;

const rootArtifactIgnorePatterns = ["dist/**", ".tmp/**", ".wrangler/**"] as const;

const config = {
  fmt: {
    ...sharedFmtConfig,
    ignorePatterns: [...rootArtifactIgnorePatterns, ...generatedGraphqlIgnorePatterns],
  },
  lint: createSharedLintConfig({
    env: {
      browser: true,
      builtin: true,
      node: true,
      serviceworker: true,
      "shared-node-browser": true,
      vitest: true,
      worker: true,
    },
    extraOverrides: [
      {
        files: ["apps/driver/**/*.ts", "apps/api/bin/**/*.ts", "apps/*/vite.config.ts"],
        rules: {
          "import/no-nodejs-modules": "off",
        },
      },
    ],
    ignorePatterns: [...rootArtifactIgnorePatterns, ...generatedGraphqlIgnorePatterns],
  }),
} satisfies Pick<UserConfig, "fmt" | "lint">;

export default config;
