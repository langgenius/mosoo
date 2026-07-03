import type { CodegenConfig } from "@graphql-codegen/cli";

export const ensureTrailingNewline = (_filePath: string, content: string) =>
  content.endsWith("\n") ? content : `${content}\n`;

// Mark each generated document as side-effect free so the bundler can drop
// the ones a chunk does not import. Together with the graphql-document
// optimizer plugin in apps/web/vite.config.ts (which rewrites `graphql(...)`
// calls into direct named imports), this keeps a page's chunk down to only
// the GraphQL documents it actually executes instead of the whole project
// set.
export const annotateDocumentsAsPure = (filePath: string, content: string) =>
  filePath.endsWith("src/gql/graphql.ts")
    ? content.replaceAll("= new TypedDocumentString(", "= /*#__PURE__*/ new TypedDocumentString(")
    : content;

export const applyWriteHooks = (filePath: string, content: string) =>
  ensureTrailingNewline(filePath, annotateDocumentsAsPure(filePath, content));

const config: CodegenConfig = {
  config: {
    arrayInputCoercion: false,
    avoidOptionals: {
      field: true,
      object: true,
    },
    documentMode: "string",
    enumsAsTypes: true,
    scalars: {
      JsonObject: "@mosoo/contracts#JsonObject",
      PrimitiveRecord: "@mosoo/contracts#PrimitiveRecord",
      ULID: {
        input: "@mosoo/id#PlatformId",
        output: "@mosoo/id#PlatformId",
      },
    },
    strictScalars: true,
    useTypeImports: true,
  },
  documents: ["apps/web/src/**/*.{ts,tsx}", "!apps/web/src/gql/**/*"],
  generates: {
    "./apps/api/src/adapters/graphql/schema.generated.graphql": {
      config: {
        includeDirectives: true,
      },
      plugins: ["schema-ast"],
    },
    "./apps/web/src/gql/": {
      preset: "client",
      presetConfig: {
        fragmentMasking: false,
      },
    },
  },
  hooks: {
    beforeOneFileWrite: applyWriteHooks,
  },
  schema: "./apps/api/src/adapters/graphql/codegen-schema.ts",
};

export default config;
