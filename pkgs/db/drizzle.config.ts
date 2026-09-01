import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  migrations: {
    prefix: "index",
  },
  out: "./drizzle",
  schema: "./src/migration-schema.ts",
  strict: true,
  verbose: true,
});
