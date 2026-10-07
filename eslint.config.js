import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "node_modules/**",
      "docs/**",
      ".turbo/**",
      "coverage/**",
      "packages/ui/.storybook/**",
      "packages/ui/src/**/*.stories.tsx",
      "packages/ui/storybook-static/**",
      "**/.pack/**",
      "**/.vscode-test/**",
      "**/*.tsbuildinfo",
      "eslint.config.js",
      "prettier.config.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["packages/protocol/src/version.test.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // The protocol uses `void` as the params type of no-payload RPC methods.
      "@typescript-eslint/no-invalid-void-type": "off",
    },
  },
  {
    files: ["packages/adapters/**/*.ts"],
    rules: {
      // The TypeScript rule checks `import type`. Adapters must not reach conflict logic through a type import.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@smartmerge/core",
              message:
                "Adapters render state and forward actions. They must not import resolution, merge, or strategy modules.",
              allowTypeImports: false,
            },
          ],
          patterns: [
            {
              group: [
                "**/core/src/strategies",
                "**/core/src/strategies.js",
                "**/core/src/strategies.ts",
                "**/core/src/structure",
                "**/core/src/structure.js",
                "**/core/src/structure.ts",
                "**/core/src/verify",
                "**/core/src/verify.js",
                "**/core/src/verify.ts",
                "**/core/src/apply",
                "**/core/src/apply.js",
                "**/core/src/apply.ts",
                "**/core/src/index",
                "**/core/src/index.js",
                "**/core/src/index.ts",
              ],
              message:
                "Adapters render state and forward actions. They must not import resolution, merge, or strategy modules.",
              allowTypeImports: false,
            },
          ],
        },
      ],
    },
  },
);
