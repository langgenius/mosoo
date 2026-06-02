import type { CodegenConfig } from "@graphql-codegen/cli";

export const ensureTrailingNewline = (_filePath: string, content: string) =>
  content.endsWith("\n") ? content : `${content}\n`;

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
    beforeOneFileWrite: ensureTrailingNewline,
  },
  schema: "./apps/api/src/adapters/graphql/codegen-schema.ts",
};

export default config;
