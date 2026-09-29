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
);
