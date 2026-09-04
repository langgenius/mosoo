import { defineConfig } from "vite-plus";

import rootConfig from "../../vite.config.ts";

export default defineConfig({
  ...rootConfig,
  pack: {
    dts: true,
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    platform: "neutral",
    target: "es2022",
  },
});
