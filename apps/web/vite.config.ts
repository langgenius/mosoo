import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vite-plus";

import { createSharedLintConfig, sharedFmtConfig } from "../../config/vite-plus.shared.ts";

const sourceRoot = fileURLToPath(new URL("src", import.meta.url));
const webDevPort = Number(process.env["WEB_DEV_PORT"] ?? "5173");
// API proxy target auto-pairs with WRANGLER_DEV_PORT so that setting only
// The port pair (WEB_DEV_PORT + WRANGLER_DEV_PORT) per checkout is enough —
// No need to also set API_PROXY_TARGET. Explicit API_PROXY_TARGET still wins
// For the rare case of pointing vite at a remote api.
const wranglerDevPort = process.env["WRANGLER_DEV_PORT"]?.trim() ?? "8787";
const apiProxyTarget = process.env["API_PROXY_TARGET"] ?? `http://localhost:${wranglerDevPort}`;

// Replace `graphql(/* GraphQL */ \`...\`)` calls with the fully resolved
// document text from the generated artifact (src/gql/graphql.ts) at build
// time. Without this, every call resolves through the src/gql/gql.ts runtime
// lookup map, which references every operation in the project — so the full
// document set (~76 KB minified) is baked into the entry chunk and downloaded
// on every page, including the public /login route. Rewriting the call into a
// direct import is not enough either: all documents live in the single
// generated module, and since each one is used by some route, the whole
// module survives tree-shaking and stays on the critical path. Inlining the
// resolved text (operation plus its fragment dependencies, exactly what the
// artifact's TypedDocumentString wraps and what requestGraphQL sends over the
// wire) removes the runtime dependency on src/gql entirely, so each chunk
// carries only the documents it executes. The codegen artifact and call sites
// are both machine-enforced shapes: one definition per template, PascalCase
// names, no interpolation, no backticks — which is what makes this
// string-level rewrite safe. Build-only: dev and tests keep the gql.ts map,
// and tsc still type-checks the original call sites.
const graphqlCallPattern = /\bgraphql\(\s*(?:\/\*\s*GraphQL\s*\*\/\s*)?`([^`]+)`\s*\)/g;
const graphqlDefinitionPattern =
  /\b(query|mutation|subscription|fragment)\s+([A-Za-z][A-Za-z0-9_]*)/;
const generatedDocumentPattern =
  /export const (\w+) =(?: \/\*#__PURE__\*\/)? new TypedDocumentString\(`([^`]+)`/g;

function loadGeneratedDocumentTexts(): Map<string, string> {
  const artifact = readFileSync(resolve(sourceRoot, "gql/graphql.ts"), "utf8");
  const texts = new Map<string, string>();
  for (const [, documentName, documentText] of artifact.matchAll(generatedDocumentPattern)) {
    if (documentName !== undefined && documentText !== undefined) {
      texts.set(documentName, documentText);
    }
  }
  return texts;
}

function graphqlDocumentOptimizer() {
  let documentTexts: Map<string, string> | null = null;

  return {
    apply: "build" as const,
    enforce: "pre" as const,
    name: "graphql-document-optimizer",
    transform(code: string, id: string) {
      const queryIndex = id.indexOf("?");
      const filePath = queryIndex === -1 ? id : id.slice(0, queryIndex);
      if (!filePath.startsWith(sourceRoot) || !/\.tsx?$/.test(filePath)) {
        return null;
      }
      if (filePath.startsWith(resolve(sourceRoot, "gql")) || !code.includes("graphql(")) {
        return null;
      }

      documentTexts ??= loadGeneratedDocumentTexts();
      const texts = documentTexts;
      const failures: string[] = [];
      const rewritten = code.replace(graphqlCallPattern, (match, documentSource: string) => {
        const definition = graphqlDefinitionPattern.exec(documentSource);
        const kind = definition?.[1];
        const name = definition?.[2];
        if (kind === undefined || name === undefined) {
          failures.push(
            `could not find an operation or fragment definition in a graphql() call in ${filePath}`,
          );
          return match;
        }
        const documentName = kind === "fragment" ? `${name}FragmentDoc` : `${name}Document`;
        const text = texts.get(documentName);
        if (text === undefined) {
          failures.push(
            `${documentName} (used in ${filePath}) is missing from src/gql/graphql.ts — run \`bun run graphql:codegen\``,
          );
          return match;
        }
        return `\`${text.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")}\``;
      });

      if (failures.length > 0) {
        throw new Error(`graphql-document-optimizer: ${failures.join("; ")}`);
      }
      if (rewritten === code) {
        return null;
      }

      return { code: rewritten, map: null };
    },
  };
}

const toolConfig = {
  fmt: sharedFmtConfig,
  lint: createSharedLintConfig({
    env: {
      browser: true,
      builtin: true,
      serviceworker: true,
      "shared-node-browser": true,
      vitest: true,
      worker: true,
    },
    ignorePatterns: ["dist/**", "src/gql/**"],
  }),
} satisfies Pick<UserConfig, "fmt" | "lint">;

const webConfig = {
  ...toolConfig,
  build: {
    rollupOptions: {
      output: {
        // Pull the stable framework runtime (React, React DOM, the router, and
        // TanStack Query) out of the app entry chunk into its own long-lived
        // vendor chunk. These packages change only on dependency bumps, so a
        // returning visitor keeps them in cache across every app deploy instead
        // of re-downloading ~150 KB of unchanged framework code baked into the
        // entry. The framework and its peers share one chunk so React stays a
        // single instance and there is no cross-chunk import waterfall.
        codeSplitting: {
          groups: [
            {
              name: "framework",
              priority: 10,
              test: /[\\/]node_modules[\\/](\.bun[\\/])?(react|react-dom|scheduler|react-router|react-router-dom|@tanstack[\\/]react-query|@tanstack[\\/]query-core)[@\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [graphqlDocumentOptimizer(), ...react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(sourceRoot),
    },
  },
  server: {
    host: "0.0.0.0",
    port: webDevPort,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        ws: true,
      },
    },
    strictPort: true,
  },
  test: {
    environment: "jsdom",
  },
};

export default webConfig;
