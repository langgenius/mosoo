import type { UserConfig } from "vite-plus";

type LintRuleLevel = "allow" | "off" | "warn" | "error" | "deny" | number;
type LintRuleConfig = LintRuleLevel | [LintRuleLevel, ...unknown[]];
type LintPlugin =
  | "eslint"
  | "import"
  | "jest"
  | "jsdoc"
  | "jsx-a11y"
  | "nextjs"
  | "node"
  | "oxc"
  | "promise"
  | "react"
  | "react-perf"
  | "typescript"
  | "unicorn"
  | "vitest"
  | "vue";

const sharedLintCategories = {
  correctness: "error",
  nursery: "off",
  pedantic: "off",
  perf: "error",
  restriction: "off",
  style: "off",
  suspicious: "error",
} satisfies Record<string, LintRuleLevel>;

const sharedLintOptions = {
  denyWarnings: true,
  reportUnusedDisableDirectives: "error",
  typeAware: true,
  typeCheck: false,
} satisfies {
  readonly denyWarnings: boolean;
  readonly reportUnusedDisableDirectives: LintRuleLevel;
  readonly typeAware: boolean;
  readonly typeCheck: boolean;
};

const sharedLintPlugins: LintPlugin[] = [
  "eslint",
  "import",
  "jest",
  "jsdoc",
  "jsx-a11y",
  "nextjs",
  "node",
  "oxc",
  "promise",
  "react",
  "react-perf",
  "typescript",
  "unicorn",
  "vitest",
  "vue",
] satisfies LintPlugin[];

const sharedTestLintRules = {
  "class-methods-use-this": "off",
  "import/max-dependencies": "off",
  "import/no-nodejs-modules": "off",
  "jest/no-conditional-in-test": "off",
  "max-lines": "off",
  "max-params": "off",
  "no-await-in-loop": "off",
  "no-empty-function": "off",
  "typescript/no-redundant-type-constituents": "off",
  "typescript/no-unnecessary-type-parameters": "off",
  "typescript/no-unsafe-argument": "off",
  "typescript/no-unsafe-assignment": "off",
  "typescript/no-unsafe-call": "off",
  "typescript/no-unsafe-member-access": "off",
  "typescript/no-unsafe-return": "off",
  "typescript/no-unsafe-type-assertion": "off",
  "typescript/require-await": "off",
} satisfies Record<string, LintRuleConfig>;

const sharedLintRules = {
  "@typescript-eslint/no-explicit-any": "error",
  "capitalized-comments": "off",
  "class-methods-use-this": "off",
  complexity: "off",
  "default-case": "off",
  "func-style": "off",
  "id-length": "off",
  "import/consistent-type-specifier-style": "error",
  "import/exports-last": "off",
  "import/group-exports": "off",
  "import/max-dependencies": "off",
  "import/no-default-export": "off",
  "import/no-duplicates": "off",
  "import/no-named-export": "off",
  "import/no-relative-parent-imports": "off",
  "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
  "import/prefer-default-export": "off",
  "init-declarations": "off",
  "jest/require-hook": "off",
  "max-depth": "off",
  "max-lines": "off",
  "max-lines-per-function": "off",
  "max-params": "off",
  "max-statements": "off",
  "nextjs/no-assign-module-variable": "off",
  "nextjs/no-html-link-for-pages": "off",
  "nextjs/no-img-element": "off",
  "no-await-in-loop": "off",
  "no-bitwise": "off",
  "no-continue": "off",
  "no-duplicate-imports": "off",
  "no-inline-comments": "off",
  "no-loop-func": "off",
  "no-magic-numbers": "off",
  "no-negated-condition": "off",
  "no-nested-ternary": "off",
  "no-ternary": "off",
  "no-undefined": "off",
  "no-unused-expressions": "off",
  "no-unused-vars": "off",
  "no-use-before-define": "off",
  "no-useless-assignment": "off",
  "no-useless-return": "off",
  "no-void": "off",
  "node/no-process-env": "off",
  "oxc/no-async-await": "off",
  "oxc/no-barrel-file": "off",
  "oxc/no-optional-chaining": "off",
  "oxc/no-rest-spread-properties": "off",
  "prefer-const": "off",
  "prefer-destructuring": "off",
  "prefer-template": "off",
  "promise/always-return": "off",
  "promise/prefer-await-to-callbacks": "off",
  "promise/prefer-await-to-then": "off",
  "react-perf/jsx-no-jsx-as-prop": "off",
  "react-perf/jsx-no-new-array-as-prop": "off",
  "react-perf/jsx-no-new-function-as-prop": "off",
  "react-perf/jsx-no-new-object-as-prop": "off",
  "react/button-has-type": "off",
  "react/exhaustive-deps": "off",
  "react/jsx-filename-extension": "off",
  "react/jsx-handler-names": "off",
  "react/jsx-max-depth": "off",
  "react/jsx-no-constructed-context-values": "off",
  "react/jsx-props-no-spreading": "off",
  "react/no-array-index-key": "off",
  "react/no-multi-comp": "off",
  "react/no-unescaped-entities": "off",
  "react/only-export-components": "off",
  "react/react-in-jsx-scope": "off",
  "require-await": "off",
  "sort-imports": "off",
  "sort-keys": "off",
  "typescript/consistent-return": "off",
  "typescript/consistent-type-imports": "error",
  "typescript/explicit-function-return-type": "off",
  "typescript/explicit-module-boundary-types": "off",
  "typescript/no-confusing-void-expression": "off",
  "typescript/no-deprecated": "off",
  "typescript/no-invalid-void-type": "off",
  "typescript/no-misused-promises": "off",
  "typescript/no-misused-spread": "off",
  "typescript/no-non-null-assertion": "off",
  "typescript/no-redundant-type-constituents": "off",
  "typescript/no-unnecessary-condition": "off",
  "typescript/no-unnecessary-template-expression": "off",
  "typescript/no-unsafe-argument": "off",
  "typescript/no-unsafe-assignment": "off",
  "typescript/no-unsafe-call": "off",
  "typescript/no-unsafe-enum-comparison": "off",
  "typescript/no-unsafe-member-access": "off",
  "typescript/no-unsafe-return": "off",
  "typescript/no-unsafe-type-assertion": "off",
  "typescript/prefer-readonly-parameter-types": "off",
  "typescript/require-await": "off",
  "typescript/strict-boolean-expressions": "off",
  "typescript/strict-void-return": "off",
  "typescript/unbound-method": "off",
  "unicorn/consistent-function-scoping": "off",
  "unicorn/explicit-length-check": "off",
  "unicorn/no-abusive-eslint-disable": "off",
  "unicorn/no-array-callback-reference": "off",
  "unicorn/no-await-expression-member": "off",
  "unicorn/no-immediate-mutation": "off",
  "unicorn/no-lonely-if": "off",
  "unicorn/no-nested-ternary": "off",
  "unicorn/no-null": "off",
  "unicorn/no-process-exit": "off",
  "unicorn/number-literal-case": "off",
  "unicorn/prefer-native-coercion-functions": "off",
  "unicorn/prefer-ternary": "off",
  "unicorn/prefer-top-level-await": "off",
  "vitest/prefer-importing-vitest-globals": "off",
} satisfies Record<string, LintRuleConfig>;

const sharedLintSettings = {
  react: {
    version: "19.2.5",
  },
};

interface LintOverride {
  readonly files: readonly string[];
  readonly rules: Record<string, LintRuleConfig>;
}

interface LintConfigInput {
  readonly env: Record<string, boolean>;
  readonly extraOverrides?: readonly LintOverride[];
  readonly ignorePatterns: readonly string[];
}

type SharedFmtConfig = NonNullable<UserConfig["fmt"]>;
type SharedLintConfig = NonNullable<UserConfig["lint"]>;

export const sharedFmtConfig = {
  semi: true,
  singleQuote: false,
  sortImports: true,
  sortPackageJson: true,
  sortTailwindcss: true,
} satisfies SharedFmtConfig;

export function createSharedLintConfig(input: LintConfigInput): SharedLintConfig {
  return {
    categories: sharedLintCategories,
    env: input.env,
    ignorePatterns: [...input.ignorePatterns],
    options: sharedLintOptions,
    overrides: [
      {
        files: ["**/tests/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
        rules: sharedTestLintRules,
      },
      ...(input.extraOverrides ?? []).map((override) => ({
        files: [...override.files],
        rules: override.rules,
      })),
    ],
    plugins: [...sharedLintPlugins],
    rules: sharedLintRules,
    settings: sharedLintSettings,
  };
}
